import { randomUUID } from 'node:crypto';
import {
  generateAvailabilitySlots,
  MEMBER_CHANGE_NOTICE_MS,
  type SessionChangeRequest,
  type RescheduleRequest,
  type Booking,
  type BookingRequest,
  type BookingResult,
  type SlotPreview,
  type SessionPage,
  type SessionPeriod,
  type UserRole,
} from '@thoughtfull/shared';
import { readBlockedDates, readWorkingWeek } from './availability.js';
import type { SqlDatabase, SqlExecutor } from './auth.js';

export class BookingConflictError extends Error {}
export class BookingInputError extends Error {}
export class ProfessionalNotFoundError extends Error {}
export class SessionNotFoundError extends Error {}
export class BookingPolicyError extends Error {}

export interface BookingStore {
  cancel(
    userId: string,
    role: UserRole,
    id: string,
    input: SessionChangeRequest,
    clock?: () => Date,
  ): Promise<Booking>;
  reschedule(
    memberId: string,
    id: string,
    input: RescheduleRequest,
    clock?: () => Date,
  ): Promise<Booking>;
  rescheduleSlots(
    memberId: string,
    id: string,
    now: Date,
  ): Promise<SlotPreview>;
  listSessions(
    userId: string,
    role: UserRole,
    period: SessionPeriod,
    page: number,
    now: Date,
  ): Promise<SessionPage>;
  calendar(
    memberId: string,
    professionalId: string,
    now: Date,
  ): Promise<SlotPreview>;
  book(
    memberId: string,
    input: BookingRequest,
    clock?: () => Date,
  ): Promise<BookingResult>;
  find(memberId: string, id: string): Promise<Booking | null>;
  freeProfessionalSlots(
    professionalId: string,
    preview: SlotPreview,
  ): Promise<SlotPreview>;
}

type BookingRow = {
  id: string;
  professional_id: string;
  starts_at: Date;
  ends_at: Date;
  status: Booking['status'];
};

function publicBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    professionalId: row.professional_id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
  };
}

async function withoutConflicts(
  db: SqlExecutor,
  preview: SlotPreview,
  professionalId: string,
  memberId?: string,
  excludeBookingId?: string,
): Promise<SlotPreview> {
  if (preview.slots.length === 0) return preview;

  const first = preview.slots[0]!;
  const last = preview.slots[preview.slots.length - 1]!;
  const { rows } = await db.query<{ starts_at: Date; ends_at: Date }>(
    "SELECT starts_at, ends_at FROM bookings WHERE status = 'confirmed' AND (professional_id = $1 OR member_id = $2) AND starts_at < $3 AND ends_at > $4 AND ($5::uuid IS NULL OR id <> $5)",
    [
      professionalId,
      memberId ?? null,
      last.endsAt,
      first.startsAt,
      excludeBookingId ?? null,
    ],
  );

  return {
    ...preview,
    slots: preview.slots.filter(
      (slot) =>
        !rows.some(
          (row) =>
            row.starts_at.getTime() < Date.parse(slot.endsAt) &&
            row.ends_at.getTime() > Date.parse(slot.startsAt),
        ),
    ),
  };
}

type OwnedBookingRow = BookingRow & { member_id: string };

function checkMemberDeadline(
  booking: Pick<BookingRow, 'starts_at'>,
  now: Date,
) {
  if (booking.starts_at.getTime() - now.getTime() < MEMBER_CHANGE_NOTICE_MS)
    throw new BookingPolicyError(
      'Members cannot cancel or reschedule within 24 hours of the session start.',
    );
}

async function scheduleReminders(
  db: SqlExecutor,
  booking: OwnedBookingRow,
  now: Date,
) {
  for (const offset of [1440, 60]) {
    const scheduledAt = new Date(booking.starts_at.getTime() - offset * 60_000);

    if (scheduledAt < now) continue;

    for (const recipientId of [booking.member_id, booking.professional_id]) {
      await db.query(
        'INSERT INTO booking_reminders (id, booking_id, recipient_id, offset_minutes, scheduled_at) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), booking.id, recipientId, offset, scheduledAt],
      );
    }
  }
}

async function lockOwnedBooking(
  db: SqlExecutor,
  userId: string,
  role: UserRole,
  id: string,
) {
  const owner = role === 'member' ? 'member_id' : 'professional_id';
  const { rows } = await db.query<OwnedBookingRow>(
    `SELECT id, member_id, professional_id, starts_at, ends_at, status FROM bookings WHERE id = $1 AND ${owner} = $2`,
    [id, userId],
  );
  const booking = rows[0];

  if (!booking) throw new SessionNotFoundError();

  // Match the booking/availability lock order: participants first, then the booking.
  const { rows: participants } = await db.query<{
    id: string;
    timezone: string;
  }>(
    'SELECT id, timezone FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [[booking.member_id, booking.professional_id]],
  );
  const { rows: current } = await db.query<OwnedBookingRow>(
    `SELECT id, member_id, professional_id, starts_at, ends_at, status FROM bookings WHERE id = $1 AND ${owner} = $2 FOR UPDATE`,
    [id, userId],
  );

  if (!current[0]) throw new SessionNotFoundError();

  return { booking: current[0], participants };
}

function checkExpectedStart(booking: BookingRow, expected: string) {
  if (booking.starts_at.getTime() !== Date.parse(expected))
    throw new BookingConflictError(
      'This session has changed. Refresh your sessions before trying again.',
    );
}

export function createBookingStore(database: SqlDatabase): BookingStore {
  return {
    async cancel(userId, role, id, input, clock = () => new Date()) {
      return database.transaction(async (db) => {
        const { booking } = await lockOwnedBooking(db, userId, role, id);
        checkExpectedStart(booking, input.expectedStartsAt);

        // Cancellation retries are safe, even after the original deadline passes.
        if (booking.status === 'cancelled') return publicBooking(booking);
        if (role === 'member') checkMemberDeadline(booking, clock());

        const { rows } = await db.query<BookingRow>(
          "UPDATE bookings SET status = 'cancelled' WHERE id = $1 RETURNING id, professional_id, starts_at, ends_at, status",
          [id],
        );
        await db.query(
          'DELETE FROM booking_reminders WHERE booking_id = $1 AND delivered_at IS NULL',
          [id],
        );

        return publicBooking(rows[0]!);
      });
    },

    async rescheduleSlots(memberId, id, now) {
      const booking = await this.find(memberId, id);

      if (!booking) throw new SessionNotFoundError();
      if (booking.status !== 'confirmed')
        throw new BookingConflictError(
          'Cancelled sessions cannot be rescheduled.',
        );
      checkMemberDeadline({ starts_at: new Date(booking.startsAt) }, now);

      const { rows } = await database.query<{ id: string; timezone: string }>(
        'SELECT id, timezone FROM users WHERE id = ANY($1::uuid[])',
        [[memberId, booking.professionalId]],
      );
      const days = await readWorkingWeek(database, booking.professionalId);
      const blocked = await readBlockedDates(database, booking.professionalId);
      const preview = generateAvailabilitySlots(
        days,
        rows.find((u) => u.id === booking.professionalId)!.timezone,
        now.toISOString(),
        rows.find((u) => u.id === memberId)!.timezone,
        blocked,
      );
      const free = await withoutConflicts(
        database,
        preview,
        booking.professionalId,
        memberId,
        id,
      );

      return {
        ...free,
        slots: free.slots.filter(
          (slot) => Date.parse(slot.startsAt) !== Date.parse(booking.startsAt),
        ),
      };
    },

    async reschedule(memberId, id, input, clock = () => new Date()) {
      try {
        return await database.transaction(async (db) => {
          const { booking, participants } = await lockOwnedBooking(
            db,
            memberId,
            'member',
            id,
          );
          checkExpectedStart(booking, input.expectedStartsAt);
          if (booking.status !== 'confirmed')
            throw new BookingConflictError(
              'Cancelled sessions cannot be rescheduled.',
            );
          checkMemberDeadline(booking, clock());

          const days = await readWorkingWeek(db, booking.professional_id);
          const blocked = await readBlockedDates(db, booking.professional_id);
          const preview = generateAvailabilitySlots(
            days,
            participants.find((u) => u.id === booking.professional_id)!
              .timezone,
            clock().toISOString(),
            participants.find((u) => u.id === memberId)!.timezone,
            blocked,
          );
          const slot = preview.slots.find(
            (value) =>
              Date.parse(value.startsAt) === Date.parse(input.startsAt),
          );

          if (!slot)
            throw new BookingInputError(
              'This time is no longer offered. Please choose an available slot.',
            );
          const acceptedAt = clock();
          checkMemberDeadline(booking, acceptedAt);
          if (Date.parse(slot.startsAt) <= acceptedAt.getTime())
            throw new BookingInputError(
              'Sessions in the past cannot be booked.',
            );
          if (Date.parse(slot.startsAt) === booking.starts_at.getTime())
            return publicBooking(booking);

          // Updating the existing row keeps the move atomic and preserves its identity.
          const { rows } = await db.query<OwnedBookingRow>(
            'UPDATE bookings SET starts_at = $2, ends_at = $3 WHERE id = $1 RETURNING id, member_id, professional_id, starts_at, ends_at, status',
            [id, slot.startsAt, slot.endsAt],
          );
          await db.query(
            'DELETE FROM booking_reminders WHERE booking_id = $1',
            [id],
          );
          await scheduleReminders(db, rows[0]!, acceptedAt);

          return publicBooking(rows[0]!);
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === '23P01'
        )
          throw new BookingConflictError(
            'This slot is no longer available, or it overlaps one of your sessions. Your original session has been kept.',
          );

        throw error;
      }
    },

    async listSessions(userId, role, period, page, now) {
      const owner = role === 'member' ? 'member_id' : 'professional_id';
      const counterpart = role === 'member' ? 'professional_id' : 'member_id';
      const upcoming = period === 'upcoming';
      const { rows } = await database.query<
        BookingRow & { counterpart_name: string }
      >(
        `SELECT b.id, b.starts_at, b.ends_at, b.status, u.name AS counterpart_name
         FROM bookings b JOIN users u ON u.id = b.${counterpart}
         WHERE b.${owner} = $1 AND ${upcoming ? "b.ends_at > $2 AND b.status = 'confirmed'" : 'b.ends_at <= $2'}
         ORDER BY b.starts_at ${upcoming ? 'ASC' : 'DESC'}, b.id ASC
         LIMIT 21 OFFSET $3`,
        [userId, now, (page - 1) * 20],
      );

      return {
        sessions: rows.slice(0, 20).map((row) => ({
          id: row.id,
          counterpartName: row.counterpart_name,
          startsAt: row.starts_at.toISOString(),
          endsAt: row.ends_at.toISOString(),
          status: row.status,
        })),
        nextPage: rows.length > 20 ? page + 1 : null,
      };
    },

    async calendar(memberId, professionalId, now) {
      const { rows } = await database.query<{
        id: string;
        role: string;
        timezone: string;
      }>('SELECT id, role, timezone FROM users WHERE id = ANY($1::uuid[])', [
        [memberId, professionalId],
      ]);
      const professional = rows.find(
        (row) => row.id === professionalId && row.role === 'professional',
      );
      const member = rows.find(
        (row) => row.id === memberId && row.role === 'member',
      );

      if (!professional) throw new ProfessionalNotFoundError();
      if (!member) throw new BookingInputError('Member not found.');

      const days = await readWorkingWeek(database, professionalId);
      const blocked = await readBlockedDates(database, professionalId);
      const preview = generateAvailabilitySlots(
        days,
        professional.timezone,
        now.toISOString(),
        member.timezone,
        blocked,
      );

      return withoutConflicts(database, preview, professionalId, memberId);
    },

    async book(memberId, input, clock = () => new Date()) {
      const start = new Date(input.startsAt);

      if (!Number.isFinite(start.getTime()))
        throw new BookingInputError('Choose a valid session time.');

      try {
        return await database.transaction(async (db) => {
          // Consistent lock order prevents deadlocks and coordinates with working-hours updates.
          const { rows: users } = await db.query<{
            id: string;
            role: string;
            timezone: string;
          }>(
            'SELECT id, role, timezone FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
            [[memberId, input.professionalId]],
          );
          const professional = users.find(
            (user) =>
              user.id === input.professionalId && user.role === 'professional',
          );
          const member = users.find(
            (user) => user.id === memberId && user.role === 'member',
          );

          if (!professional) throw new ProfessionalNotFoundError();
          if (!member) throw new BookingInputError('Member not found.');

          const { rows: existing } = await db.query<BookingRow>(
            'SELECT id, professional_id, starts_at, ends_at, status FROM bookings WHERE member_id = $1 AND request_id = $2',
            [memberId, input.requestId],
          );

          if (existing[0]) {
            if (
              existing[0].professional_id !== input.professionalId ||
              existing[0].starts_at.getTime() !== start.getTime()
            )
              throw new BookingConflictError(
                'This request was already used for a different session.',
              );

            return { booking: publicBooking(existing[0]), replayed: true };
          }

          const now = clock();
          const days = await readWorkingWeek(db, input.professionalId);
          const blocked = await readBlockedDates(db, input.professionalId);
          const preview = generateAvailabilitySlots(
            days,
            professional.timezone,
            now.toISOString(),
            member.timezone,
            blocked,
          );
          const slot = preview.slots.find(
            (value) => Date.parse(value.startsAt) === start.getTime(),
          );

          if (!slot)
            throw new BookingInputError(
              'This time is no longer offered. Please choose an available slot.',
            );

          const acceptedAt = clock();

          if (start.getTime() <= acceptedAt.getTime())
            throw new BookingInputError(
              'Sessions in the past cannot be booked.',
            );

          const id = randomUUID();
          const { rows } = await db.query<BookingRow>(
            'INSERT INTO bookings (id, member_id, professional_id, request_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, professional_id, starts_at, ends_at, status',
            [
              id,
              memberId,
              input.professionalId,
              input.requestId,
              slot.startsAt,
              slot.endsAt,
            ],
          );

          await scheduleReminders(
            db,
            { ...rows[0]!, member_id: memberId },
            acceptedAt,
          );

          return { booking: publicBooking(rows[0]!), replayed: false };
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === '23P01'
        )
          throw new BookingConflictError(
            'This slot is no longer available, or it overlaps one of your sessions. Please choose another time.',
          );

        throw error;
      }
    },

    async find(memberId, id) {
      const { rows } = await database.query<BookingRow>(
        'SELECT id, professional_id, starts_at, ends_at, status FROM bookings WHERE id = $1 AND member_id = $2',
        [id, memberId],
      );

      return rows[0] ? publicBooking(rows[0]) : null;
    },

    async freeProfessionalSlots(professionalId, preview) {
      return withoutConflicts(database, preview, professionalId);
    },
  };
}
