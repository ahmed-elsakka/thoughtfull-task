// Creates and removes only its own uniquely named local test database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { createDatabase } from '@thoughtfull/db';
import { emptyWeek } from '@thoughtfull/shared';

const env = new URL('../../.env', import.meta.url);
if (existsSync(env)) loadEnvFile(env);
if (!process.env.DATABASE_URL)
  throw new Error(
    'Set DATABASE_URL for a local PostgreSQL server with permission to create a test database.',
  );
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('This test only operates on a local PostgreSQL server.');
const name = `thoughtfull_booking_test_${randomUUID().replaceAll('-', '')}`;
if (!/^thoughtfull_booking_test_[a-f0-9]{32}$/.test(name))
  throw new Error('Invalid test database name.');
const admin = new pg.Pool({ connectionString: url.toString() });
let created = false;
let database: ReturnType<typeof createDatabase> | undefined;
const now = () => new Date('2026-11-02T00:00:00Z');

try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  database = createDatabase(url.toString());
  const migrations = new URL('../../packages/db/migrations/', import.meta.url);

  for (const file of (await readdir(migrations))
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    await database.pool.query(
      await readFile(new URL(file, migrations), 'utf8'),
    );
  }

  async function user(role: 'member' | 'professional', opening = '09:00') {
    const id = randomUUID();
    await database!.pool.query(
      'INSERT INTO users (id, name, email, password_hash, role, timezone) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        id,
        'Fictional concurrency test',
        `${id}@example.test`,
        'not-used',
        role,
        'UTC',
      ],
    );

    if (role === 'professional')
      await database!.availabilityStore.replaceWeek(
        id,
        emptyWeek().map((day) => ({
          ...day,
          startTime: opening,
          endTime: '17:00',
        })),
      );

    return id;
  }

  const member = await user('member');
  const other = await user('member');
  const professional = await user('professional');
  const second = await user('professional', '09:30');
  const input = {
    professionalId: professional,
    startsAt: '2026-11-04T09:00:00Z',
    requestId: randomUUID(),
  };
  const sameSlot = await Promise.allSettled([
    database.bookingStore.book(member, input, now),
    database.bookingStore.book(
      other,
      { ...input, requestId: randomUUID() },
      now,
    ),
  ]);
  assert.equal(
    sameSlot.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    (await database.pool.query('SELECT * FROM bookings')).rowCount,
    1,
  );
  console.log(
    'PASS: concurrent members cannot book the same professional slot.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const sameMember = await Promise.allSettled([
    database.bookingStore.book(
      member,
      { ...input, requestId: randomUUID() },
      now,
    ),
    database.bookingStore.book(
      member,
      {
        professionalId: second,
        startsAt: '2026-11-04T09:30:00Z',
        requestId: randomUUID(),
      },
      now,
    ),
  ]);
  assert.equal(
    sameMember.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  console.log(
    'PASS: one member cannot concurrently book overlapping sessions with different professionals.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const retries = await Promise.all([
    database.bookingStore.book(member, input, now),
    database.bookingStore.book(member, input, now),
  ]);
  assert.equal(retries[0]!.booking.id, retries[1]!.booking.id);
  assert.equal(
    (await database.pool.query('SELECT * FROM bookings')).rowCount,
    1,
  );
  assert.equal(
    (await database.pool.query('SELECT * FROM booking_reminders')).rowCount,
    4,
  );
  console.log(
    'PASS: simultaneous retries create one booking and one reminder set.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const insert = (memberId: string) =>
    database!.pool.query(
      'INSERT INTO bookings (id, member_id, professional_id, request_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        randomUUID(),
        memberId,
        professional,
        randomUUID(),
        input.startsAt,
        '2026-11-04T09:50:00Z',
      ],
    );
  const direct = await Promise.allSettled([insert(member), insert(other)]);
  assert.equal(
    direct.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    (await database.pool.query('SELECT * FROM bookings')).rowCount,
    1,
  );
  console.log(
    'PASS: database exclusion constraints protect direct concurrent SQL writes.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const original = (await database.bookingStore.book(member, input, now))
    .booking;
  const target = '2026-11-05T10:00:00Z';
  const competing = await Promise.allSettled([
    database.bookingStore.reschedule(
      member,
      original.id,
      { expectedStartsAt: original.startsAt, startsAt: target },
      now,
    ),
    database.bookingStore.book(
      other,
      { ...input, startsAt: target, requestId: randomUUID() },
      now,
    ),
  ]);
  assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
  const retained = await database.bookingStore.find(member, original.id);
  assert.ok(retained);
  assert.equal(retained.status, 'confirmed');
  assert.equal(
    retained.startsAt,
    competing[0]!.status === 'fulfilled'
      ? new Date(target).toISOString()
      : original.startsAt,
  );
  console.log(
    'PASS: a reschedule racing a new booking keeps exactly one valid member session.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const toMove = (await database.bookingStore.book(member, input, now)).booking;
  const moves = await Promise.allSettled([
    database.bookingStore.reschedule(
      member,
      toMove.id,
      { expectedStartsAt: toMove.startsAt, startsAt: target },
      now,
    ),
    database.bookingStore.reschedule(
      member,
      toMove.id,
      { expectedStartsAt: toMove.startsAt, startsAt: '2026-11-06T10:00:00Z' },
      now,
    ),
  ]);
  assert.equal(moves.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await database.pool.query('SELECT * FROM bookings')).rowCount,
    1,
  );
  assert.equal(
    (await database.pool.query('SELECT * FROM booking_reminders')).rowCount,
    4,
  );
  console.log(
    'PASS: concurrent reschedules cannot overwrite each other or duplicate sessions/reminders.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const toChange = (await database.bookingStore.book(member, input, now))
    .booking;
  const changes = await Promise.allSettled([
    database.bookingStore.cancel(
      professional,
      'professional',
      toChange.id,
      { expectedStartsAt: toChange.startsAt },
      now,
    ),
    database.bookingStore.reschedule(
      member,
      toChange.id,
      { expectedStartsAt: toChange.startsAt, startsAt: target },
      now,
    ),
  ]);
  assert.equal(changes.filter((r) => r.status === 'fulfilled').length, 1);
  const final = await database.bookingStore.find(member, toChange.id);
  assert.equal(
    final!.status,
    changes[0]!.status === 'fulfilled' ? 'cancelled' : 'confirmed',
  );
  assert.equal(
    (await database.pool.query('SELECT * FROM booking_reminders')).rowCount,
    final!.status === 'cancelled' ? 0 : 4,
  );
  console.log(
    'PASS: cancellation racing rescheduling leaves a consistent session and reminder state.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const dueAt = new Date('2026-11-03T09:00:00Z');
  await database.bookingStore.book(member, input, now);
  const deliveries = await Promise.all([
    database.notificationStore.deliverDue(dueAt),
    database.notificationStore.deliverDue(dueAt),
    database.notificationStore.deliverDue(dueAt),
  ]);
  assert.equal(
    deliveries.reduce((sum, count) => sum + count, 0),
    2,
  );
  assert.equal(
    (await database.pool.query('SELECT * FROM notifications')).rowCount,
    2,
  );
  assert.equal(
    (
      await database.pool.query(
        'SELECT * FROM booking_reminders WHERE delivered_at IS NOT NULL',
      )
    ).rowCount,
    2,
  );
  assert.equal(await database.notificationStore.deliverDue(dueAt), 0);
  console.log(
    'PASS: concurrent workers deliver each due reminder exactly once.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const cancelReminder = (await database.bookingStore.book(member, input, now))
    .booking;
  await Promise.all([
    database.notificationStore.deliverDue(dueAt),
    database.bookingStore.cancel(
      professional,
      'professional',
      cancelReminder.id,
      { expectedStartsAt: cancelReminder.startsAt },
      () => dueAt,
    ),
  ]);
  const beforeCancelRetry = (
    await database.pool.query('SELECT * FROM notifications')
  ).rowCount;
  assert.ok(beforeCancelRetry === 0 || beforeCancelRetry === 2);
  assert.equal(
    await database.notificationStore.deliverDue(
      new Date('2026-11-05T00:00:00Z'),
    ),
    0,
  );
  assert.equal(
    (await database.pool.query('SELECT * FROM notifications')).rowCount,
    beforeCancelRetry,
  );
  assert.equal(
    (
      await database.pool.query(
        'SELECT * FROM booking_reminders WHERE delivered_at IS NULL',
      )
    ).rowCount,
    0,
  );
  console.log(
    'PASS: cancellation racing delivery retires pending reminders and preserves committed notifications.',
  );

  await database.pool.query(
    'TRUNCATE notifications, booking_reminders, bookings',
  );
  const moveReminder = (await database.bookingStore.book(member, input, now))
    .booking;
  await Promise.all([
    database.notificationStore.deliverDue(dueAt),
    database.bookingStore.reschedule(
      member,
      moveReminder.id,
      {
        expectedStartsAt: moveReminder.startsAt,
        startsAt: '2026-11-06T09:00:00Z',
      },
      () => dueAt,
    ),
  ]);
  const beforeMoveRetry = (
    await database.pool.query('SELECT * FROM notifications')
  ).rowCount;
  assert.ok(beforeMoveRetry === 0 || beforeMoveRetry === 2);
  assert.equal(
    await database.notificationStore.deliverDue(
      new Date('2026-11-04T08:00:00Z'),
    ),
    0,
  );
  assert.equal(
    await database.notificationStore.deliverDue(
      new Date('2026-11-05T09:00:00Z'),
    ),
    2,
  );
  assert.equal(
    (await database.pool.query('SELECT * FROM notifications')).rowCount,
    beforeMoveRetry! + 2,
  );
  console.log(
    'PASS: rescheduling racing delivery prevents obsolete pending notifications and delivers the new reminder set.',
  );
} finally {
  await database?.pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
