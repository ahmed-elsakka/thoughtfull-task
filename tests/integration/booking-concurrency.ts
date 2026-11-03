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

  await database.pool.query('TRUNCATE booking_reminders, bookings');
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

  await database.pool.query('TRUNCATE booking_reminders, bookings');
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

  await database.pool.query('TRUNCATE booking_reminders, bookings');
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
} finally {
  await database?.pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
