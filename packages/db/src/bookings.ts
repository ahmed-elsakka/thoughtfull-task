import { randomUUID } from 'node:crypto';
import {
  generateAvailabilitySlots,
  type Booking,
  type BookingRequest,
  type BookingResult,
  type SlotPreview,
} from '@thoughtfull/shared';
import { readWorkingWeek } from './availability.js';
import type { SqlDatabase, SqlExecutor } from './auth.js';

export class BookingConflictError extends Error {}
export class BookingInputError extends Error {}
export class ProfessionalNotFoundError extends Error {}

export interface BookingStore {
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
): Promise<SlotPreview> {
  if (preview.slots.length === 0) return preview;

  const first = preview.slots[0]!;
  const last = preview.slots[preview.slots.length - 1]!;
  const { rows } = await db.query<{ starts_at: Date; ends_at: Date }>(
    "SELECT starts_at, ends_at FROM bookings WHERE status = 'confirmed' AND (professional_id = $1 OR member_id = $2) AND starts_at < $3 AND ends_at > $4",
    [professionalId, memberId ?? null, last.endsAt, first.startsAt],
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

export function createBookingStore(database: SqlDatabase): BookingStore {
  return {
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
      const preview = generateAvailabilitySlots(
        days,
        professional.timezone,
        now.toISOString(),
        member.timezone,
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
          const preview = generateAvailabilitySlots(
            days,
            professional.timezone,
            now.toISOString(),
            member.timezone,
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

          for (const offset of [1440, 60]) {
            const scheduledAt = new Date(start.getTime() - offset * 60_000);

            if (scheduledAt.getTime() < acceptedAt.getTime()) continue;

            for (const recipientId of [memberId, input.professionalId]) {
              await db.query(
                'INSERT INTO booking_reminders (id, booking_id, recipient_id, offset_minutes, scheduled_at) VALUES ($1, $2, $3, $4, $5)',
                [randomUUID(), id, recipientId, offset, scheduledAt],
              );
            }
          }

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
