import { randomUUID } from 'node:crypto';
import type { Notification, NotificationPage } from '@thoughtfull/shared';
import type { SqlDatabase } from './auth.js';

export interface NotificationStore {
  deliverDue(now?: Date): Promise<number>;
  list(userId: string, page: number): Promise<NotificationPage>;
  markRead(userId: string, id: string, now: Date): Promise<boolean>;
}

type NotificationRow = {
  id: string;
  booking_id: string;
  counterpart_name: string;
  session_starts_at: Date;
  offset_minutes: Notification['offsetMinutes'];
  scheduled_at: Date;
  created_at: Date;
  read_at: Date | null;
};

export function createNotificationStore(
  database: SqlDatabase,
): NotificationStore {
  return {
    async deliverDue(now = new Date()) {
      let delivered = 0;
      // Discovery is not a claim. All state is reread after acquiring the participant locks.
      const { rows: candidates } = await database.query<{
        id: string;
        member_id: string;
        professional_id: string;
      }>(
        `SELECT b.id, b.member_id, b.professional_id FROM bookings b
         WHERE b.status = 'confirmed' AND EXISTS (
           SELECT 1 FROM booking_reminders r WHERE r.booking_id = b.id
           AND r.delivered_at IS NULL AND r.scheduled_at <= $1
         ) ORDER BY b.id LIMIT 50`,
        [now],
      );

      for (const candidate of candidates) {
        const count = await database.transaction(async (db) => {
          // Notification foreign keys also lock users. Match changes: users -> booking -> reminders.
          const { rows: participants } = await db.query<{ id: string }>(
            'SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
            [[candidate.member_id, candidate.professional_id]],
          );

          if (participants.length !== 2) return 0;

          const { rows: bookings } = await db.query<{
            id: string;
            member_id: string;
            starts_at: Date;
            member_name: string;
            professional_name: string;
          }>(
            `SELECT b.id, b.member_id, b.starts_at, m.name AS member_name, p.name AS professional_name
             FROM bookings b JOIN users m ON m.id = b.member_id JOIN users p ON p.id = b.professional_id
             WHERE b.id = $1 AND b.status = 'confirmed' FOR UPDATE OF b`,
            [candidate.id],
          );
          const booking = bookings[0];

          if (!booking) return 0;

          const { rows: reminders } = await db.query<{
            id: string;
            recipient_id: string;
            offset_minutes: number;
            scheduled_at: Date;
          }>(
            'SELECT id, recipient_id, offset_minutes, scheduled_at FROM booking_reminders WHERE booking_id = $1 AND delivered_at IS NULL AND scheduled_at <= $2 ORDER BY id FOR UPDATE',
            [booking.id, now],
          );
          let inserted = 0;

          for (const reminder of reminders) {
            const result = await db.query<{ id: string }>(
              `INSERT INTO notifications (id, source_reminder_id, booking_id, recipient_id, counterpart_name, session_starts_at, offset_minutes, scheduled_at, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (source_reminder_id) DO NOTHING RETURNING id`,
              [
                randomUUID(),
                reminder.id,
                booking.id,
                reminder.recipient_id,
                reminder.recipient_id === booking.member_id
                  ? booking.professional_name
                  : booking.member_name,
                booking.starts_at,
                reminder.offset_minutes,
                reminder.scheduled_at,
                now,
              ],
            );
            inserted += result.rows.length;
            await db.query(
              'UPDATE booking_reminders SET delivered_at = $2 WHERE id = $1',
              [reminder.id, now],
            );
          }

          return inserted;
        });

        delivered += count;
      }

      return delivered;
    },

    async list(userId, page) {
      const { rows } = await database.query<NotificationRow>(
        `SELECT id, booking_id, counterpart_name, session_starts_at, offset_minutes, scheduled_at, created_at, read_at
         FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC, id DESC LIMIT 21 OFFSET $2`,
        [userId, (page - 1) * 20],
      );
      const { rows: counts } = await database.query<{ count: string }>(
        'SELECT count(*) AS count FROM notifications WHERE recipient_id = $1 AND read_at IS NULL',
        [userId],
      );

      return {
        notifications: rows.slice(0, 20).map((row) => ({
          id: row.id,
          bookingId: row.booking_id,
          counterpartName: row.counterpart_name,
          sessionStartsAt: row.session_starts_at.toISOString(),
          offsetMinutes: row.offset_minutes,
          scheduledAt: row.scheduled_at.toISOString(),
          createdAt: row.created_at.toISOString(),
          readAt: row.read_at?.toISOString() ?? null,
        })),
        unreadCount: Number(counts[0]!.count),
        nextPage: rows.length > 20 ? page + 1 : null,
      };
    },

    async markRead(userId, id, now) {
      const { rows } = await database.query<{ id: string }>(
        'UPDATE notifications SET read_at = COALESCE(read_at, $3) WHERE id = $1 AND recipient_id = $2 RETURNING id',
        [id, userId, now],
      );

      return rows.length === 1;
    },
  };
}
