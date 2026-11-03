import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index,
  integer,
  primaryKey,
  check,
  unique,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['member', 'professional']);
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull(),
  timezone: text('timezone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('auth_sessions_user_idx').on(table.userId),
    index('auth_sessions_expiry_idx').on(table.expiresAt),
  ],
);

export const professionalAvailability = pgTable(
  'professional_availability',
  {
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.professionalId, table.dayOfWeek] }),
    check('availability_day_range', sql`${table.dayOfWeek} between 1 and 7`),
    check(
      'availability_time_range',
      sql`${table.startMinute} >= 0 and ${table.endMinute} <= 1439 and ${table.endMinute} - ${table.startMinute} >= 50`,
    ),
  ],
);

export const bookingStatus = pgEnum('booking_status', [
  'confirmed',
  'cancelled',
]);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id),
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => users.id),
    requestId: uuid('request_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: bookingStatus('status').notNull().default('confirmed'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('bookings_member_request_unique').on(
      table.memberId,
      table.requestId,
    ),
    check(
      'booking_duration_50_minutes',
      sql`${table.endsAt} = ${table.startsAt} + interval '50 minutes'`,
    ),
    check(
      'booking_distinct_participants',
      sql`${table.memberId} <> ${table.professionalId}`,
    ),
  ],
);

// The SQL migration additionally installs partial GiST exclusion constraints for both participants.
export const bookingReminders = pgTable(
  'booking_reminders',
  {
    id: uuid('id').primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id),
    offsetMinutes: integer('offset_minutes').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    unique('reminder_booking_recipient_offset_unique').on(
      table.bookingId,
      table.recipientId,
      table.offsetMinutes,
    ),
    check('reminder_offset_allowed', sql`${table.offsetMinutes} in (60, 1440)`),
    index('reminders_due_idx').on(table.scheduledAt),
  ],
);
