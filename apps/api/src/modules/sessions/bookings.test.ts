import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, afterEach, it, expect } from 'vitest';
import {
  createAuthStore,
  createAvailabilityStore,
  createBookingStore,
  type SqlDatabase,
} from '@thoughtfull/db';
import { emptyWeek } from '@thoughtfull/shared';
import { createTestDatabase } from '../../../../../tests/support/database.js';
import { buildApp } from '../../app.js';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let clock = new Date('2026-11-02T00:00:00Z');
const headers = {
  origin: 'http://127.0.0.1:5173',
  'x-requested-with': 'ThoughtFull',
};
const makeApp = () =>
  buildApp({
    logger: false,
    auth: {
      store: createAuthStore(fixture.sql),
      origin: headers.origin,
      secureCookies: false,
      now: () => clock,
    },
    bookings: createBookingStore(fixture.sql),
    availability: createAvailabilityStore(fixture.sql),
  });

async function user(
  role: 'member' | 'professional',
  timezone = 'UTC',
  opening = '09:00',
) {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  await createAuthStore(fixture.sql).createUser(
    {
      id,
      role,
      timezone,
      name: 'Fictional Test',
      email: `${id}@example.test`,
      passwordHash: 'not-used-for-login',
    },
    {
      userId: id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  );

  if (role === 'professional')
    await createAvailabilityStore(fixture.sql).replaceWeek(
      id,
      emptyWeek().map((day) => ({
        ...day,
        startTime: opening,
        endTime: '17:00',
      })),
    );

  return { id, cookie: `thoughtfull_session=${token}` };
}

function book(
  cookie: string,
  professionalId: string,
  startsAt = '2026-11-02T09:00:00Z',
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/bookings',
    headers: { ...headers, cookie },
    payload: { professionalId, startsAt, requestId: randomUUID(), ...extra },
  });
}

beforeAll(async () => {
  fixture = await createTestDatabase();
}, 30_000);

beforeEach(async () => {
  await fixture.database.exec(
    'TRUNCATE booking_reminders, bookings, professional_availability, auth_sessions, users',
  );
  clock = new Date('2026-11-02T00:00:00Z');
  app = makeApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await fixture.database.close();
});

it('returns four member-local weeks, only free slot instants, and no client identities', async () => {
  const member = await user('member', 'America/Los_Angeles');
  const professional = await user('professional', 'Asia/Tokyo');
  const result = await app.inject({
    url: `/api/professionals/${professional.id}/slots`,
    headers: { cookie: member.cookie },
  });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    timezone: 'America/Los_Angeles',
    fromDate: '2026-11-01',
    toDateExclusive: '2026-11-29',
  });
  expect(Object.keys(result.json().slots[0]).sort()).toEqual([
    'endsAt',
    'startsAt',
  ]);
  expect(result.body).not.toContain('Fictional Test');
  expect(result.body).not.toContain('email');
  expect(
    result
      .json()
      .slots.every(
        (s: { startsAt: string }) => Date.parse(s.startsAt) > clock.getTime(),
      ),
  ).toBe(true);
});

it('books for the authenticated member, persists across API restart, and hides the slot', async () => {
  const member = await user('member');
  const other = await user('member');
  const professional = await user('professional');
  const result = await book(member.cookie, professional.id);
  expect(result.statusCode).toBe(201);
  expect(result.json().booking).toMatchObject({
    professionalId: professional.id,
    startsAt: '2026-11-02T09:00:00.000Z',
    endsAt: '2026-11-02T09:50:00.000Z',
    status: 'confirmed',
  });
  await app.close();
  app = makeApp();
  const saved = await app.inject({
    url: `/api/bookings/${result.json().booking.id}`,
    headers: { cookie: member.cookie },
  });
  expect(saved.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        url: `/api/bookings/${result.json().booking.id}`,
        headers: { cookie: other.cookie },
      })
    ).statusCode,
  ).toBe(404);

  for (const cookie of [member.cookie, other.cookie]) {
    const calendar = await app.inject({
      url: `/api/professionals/${professional.id}/slots`,
      headers: { cookie },
    });
    expect(
      calendar
        .json()
        .slots.some(
          (s: { startsAt: string }) => s.startsAt === '2026-11-02T09:00:00Z',
        ),
    ).toBe(false);
  }

  const preview = await app.inject({
    url: '/api/professional/availability/slots',
    headers: { cookie: professional.cookie },
  });
  expect(
    preview
      .json()
      .slots.some(
        (s: { startsAt: string }) => s.startsAt === '2026-11-02T09:00:00Z',
      ),
  ).toBe(false);
});

it('rejects a stale slot and member overlaps across professionals, but permits adjacency', async () => {
  const member = await user('member');
  const other = await user('member');
  const first = await user('professional');
  const second = await user('professional', 'UTC', '09:30');
  const adjacent = await user('professional', 'UTC', '09:50');
  expect((await book(member.cookie, first.id)).statusCode).toBe(201);
  expect((await book(other.cookie, first.id)).statusCode).toBe(409);
  expect(
    (await book(member.cookie, second.id, '2026-11-02T09:30:00Z')).statusCode,
  ).toBe(409);
  const calendar = await app.inject({
    url: `/api/professionals/${second.id}/slots`,
    headers: { cookie: member.cookie },
  });
  expect(
    calendar
      .json()
      .slots.some(
        (s: { startsAt: string }) => s.startsAt === '2026-11-02T09:30:00Z',
      ),
  ).toBe(false);
  expect(
    (await book(member.cookie, adjacent.id, '2026-11-02T09:50:00Z')).statusCode,
  ).toBe(201);
});

it('replays retries without duplicate sessions or reminders, and rejects key reuse for another slot', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const requestId = randomUUID();
  const first = await book(
    member.cookie,
    professional.id,
    '2026-11-04T09:00:00Z',
    { requestId },
  );
  const retry = await book(
    member.cookie,
    professional.id,
    '2026-11-04T09:00:00Z',
    { requestId },
  );
  expect(first.statusCode).toBe(201);
  expect(retry.statusCode).toBe(200);
  expect(retry.json().booking.id).toBe(first.json().booking.id);
  expect(retry.json().replayed).toBe(true);
  expect(
    (await fixture.database.query('SELECT * FROM bookings')).rows,
  ).toHaveLength(1);
  expect(
    (await fixture.database.query('SELECT * FROM booking_reminders')).rows,
  ).toHaveLength(4);
  expect(
    (
      await book(member.cookie, professional.id, '2026-11-04T10:00:00Z', {
        requestId,
      })
    ).statusCode,
  ).toBe(409);
});

it.each([
  '2026-11-01T09:00:00Z',
  '2026-11-02T00:00:00Z',
  '2026-11-02T09:15:00Z',
  '2026-11-02T17:00:00Z',
  '2026-11-30T09:00:00Z',
])(
  'rejects past, off-grid, outside-hours or outside-window time %s',
  async (start) => {
    const member = await user('member');
    const professional = await user('professional');
    expect((await book(member.cookie, professional.id, start)).statusCode).toBe(
      400,
    );
  },
);

it('rechecks availability changes before booking', async () => {
  const member = await user('member');
  const professional = await user('professional');
  await createAvailabilityStore(fixture.sql).replaceWeek(
    professional.id,
    emptyWeek(),
  );
  expect((await book(member.cookie, professional.id)).statusCode).toBe(400);
});

it('checks server time again after acquiring participant locks', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const calls = [
    new Date('2026-11-02T08:59:59Z'),
    new Date('2026-11-02T09:00:00Z'),
  ];
  await expect(
    createBookingStore(fixture.sql).book(
      member.id,
      {
        professionalId: professional.id,
        startsAt: '2026-11-02T09:00:00Z',
        requestId: randomUUID(),
      },
      () => calls.shift()!,
    ),
  ).rejects.toThrow('past');
});

it.each([
  ['2026-11-02T08:00:00Z', 2],
  ['2026-11-02T08:00:01Z', 0],
  ['2026-11-01T09:00:00Z', 4],
])(
  'schedules only unpassed reminders for both people at clock %s',
  async (now, count) => {
    clock = new Date(now);
    const member = await user('member');
    const professional = await user('professional');
    expect((await book(member.cookie, professional.id)).statusCode).toBe(201);
    const reminders = (
      await fixture.database.query<{
        recipient_id: string;
        scheduled_at: Date;
      }>('SELECT * FROM booking_reminders')
    ).rows;
    expect(reminders).toHaveLength(count);
    expect(reminders.every((row) => row.scheduled_at >= clock)).toBe(true);
    if (count)
      expect(new Set(reminders.map((row) => row.recipient_id))).toEqual(
        new Set([member.id, professional.id]),
      );
  },
);

it('rolls back the booking when reminder persistence fails', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const broken: SqlDatabase = {
    query: fixture.sql.query,
    transaction: (run) =>
      fixture.sql.transaction((db) =>
        run({
          query: async (sql, params) => {
            if (sql.startsWith('INSERT INTO booking_reminders'))
              throw new Error('Reminder storage unavailable');

            return db.query(sql, params);
          },
        }),
      ),
  };
  await expect(
    createBookingStore(broken).book(
      member.id,
      {
        professionalId: professional.id,
        startsAt: '2026-11-04T09:00:00Z',
        requestId: randomUUID(),
      },
      () => clock,
    ),
  ).rejects.toThrow('Reminder storage');
  expect(
    (await fixture.database.query('SELECT * FROM bookings')).rows,
  ).toHaveLength(0);
});

it('enforces member access, CSRF, and rejects client identity or duration overrides', async () => {
  const member = await user('member');
  const professional = await user('professional');
  expect((await book('', professional.id)).statusCode).toBe(401);
  expect((await book(professional.cookie, professional.id)).statusCode).toBe(
    403,
  );
  expect(
    (
      await book(member.cookie, professional.id, undefined, {
        memberId: randomUUID(),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await book(member.cookie, professional.id, undefined, {
        endsAt: '2026-11-02T12:00:00Z',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/bookings',
        headers: { cookie: member.cookie },
        payload: {
          professionalId: professional.id,
          startsAt: '2026-11-02T09:00:00Z',
          requestId: randomUUID(),
        },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ url: `/api/professionals/${professional.id}/slots` }))
      .statusCode,
  ).toBe(401);
});

it('returns 404 when the requested professional is missing or a member', async () => {
  const member = await user('member');

  for (const id of [randomUUID(), member.id]) {
    expect((await book(member.cookie, id)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/professionals/${id}/slots`,
          headers: { cookie: member.cookie },
        })
      ).statusCode,
    ).toBe(404);
  }
});
