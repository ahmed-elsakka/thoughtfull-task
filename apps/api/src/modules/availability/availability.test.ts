import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  createAuthStore,
  createAvailabilityStore,
  type SqlDatabase,
} from '@thoughtfull/db';
import { emptyWeek } from '@thoughtfull/shared';
import { createTestDatabase } from '../../../../../tests/support/database.js';
import { buildApp } from '../../app.js';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
const headers = {
  origin: 'http://127.0.0.1:5173',
  'x-requested-with': 'ThoughtFull',
};
const monday = emptyWeek().map((day) =>
  day.dayOfWeek === 1 ? { ...day, startTime: '09:00', endTime: '17:00' } : day,
);
const makeApp = () =>
  buildApp({
    logger: false,
    auth: {
      store: createAuthStore(fixture.sql),
      origin: headers.origin,
      secureCookies: false,
      now: () => new Date('2026-11-02T00:00:00Z'),
    },
    availability: createAvailabilityStore(fixture.sql),
  });
let app: ReturnType<typeof makeApp>;

async function signup(
  role = 'professional',
  email = 'professional@example.test',
  timezone = 'Asia/Singapore',
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers,
    payload: {
      name: 'Example User',
      email,
      password: 'a long example password',
      role,
      timezone,
    },
  });
  expect(response.statusCode).toBe(201);

  return {
    cookie: String(response.headers['set-cookie']).split(';')[0]!,
    id: response.json().user.id as string,
  };
}

function save(cookie: string, body: unknown = { days: monday }) {
  return app.inject({
    method: 'PUT',
    url: '/api/professional/availability',
    headers: { ...headers, cookie },
    payload: body,
  });
}

beforeAll(async () => {
  fixture = await createTestDatabase();
}, 30_000);

beforeEach(async () => {
  await fixture.database.exec(
    'TRUNCATE notifications, booking_reminders, bookings, professional_availability, professional_blocked_dates, auth_sessions, users',
  );
  app = makeApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await fixture.database.close();
});

it('starts closed and persists a professional week across API restart', async () => {
  const user = await signup();
  const initial = await app.inject({
    url: '/api/professional/availability',
    headers: { cookie: user.cookie },
  });
  expect(initial.json()).toEqual({
    timezone: 'Asia/Singapore',
    days: emptyWeek(),
  });
  expect((await save(user.cookie)).statusCode).toBe(200);
  await app.close();
  app = makeApp();
  const result = await app.inject({
    url: '/api/professional/availability',
    headers: { cookie: user.cookie },
  });
  expect(result.json()).toEqual({ timezone: 'Asia/Singapore', days: monday });
  const slots = await app.inject({
    url: '/api/professional/availability/slots',
    headers: { cookie: user.cookie },
  });
  expect(slots.statusCode).toBe(200);
  // The 01:00 UTC start is only one hour after the fixed clock, inside the 2-hour notice.
  expect(slots.json().slots).toHaveLength(31);
  expect(slots.json().slots[0]).toEqual({
    startsAt: '2026-11-02T02:00:00Z',
    endsAt: '2026-11-02T02:50:00Z',
  });
});

it('can close every day and remove generated slots', async () => {
  const user = await signup();
  await save(user.cookie);
  expect((await save(user.cookie, { days: emptyWeek() })).statusCode).toBe(200);
  const slots = await app.inject({
    url: '/api/professional/availability/slots',
    headers: { cookie: user.cookie },
  });
  expect(slots.json().slots).toEqual([]);
  expect(
    (await fixture.database.query('SELECT * FROM professional_availability'))
      .rows,
  ).toHaveLength(0);
});

it('isolates professionals and ignores forged query/header identity', async () => {
  const first = await signup();
  const second = await signup('professional', 'other@example.test');
  await save(first.cookie);
  const result = await app.inject({
    url: `/api/professional/availability?professionalId=${first.id}`,
    headers: { cookie: second.cookie, 'x-user-id': first.id },
  });
  expect(result.json().days).toEqual(emptyWeek());
  expect(
    (await save(second.cookie, { days: monday, professionalId: first.id }))
      .statusCode,
  ).toBe(400);
  expect(
    (await save(second.cookie, { days: monday, timezone: 'UTC' })).statusCode,
  ).toBe(400);
});

it('blocks unauthenticated users and members from every availability route', async () => {
  const member = await signup('member');

  for (const cookie of ['', member.cookie]) {
    const status = cookie ? 403 : 401;
    expect(
      (
        await app.inject({
          url: '/api/professional/availability',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(status);
    expect(
      (
        await app.inject({
          url: '/api/professional/availability/slots',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(status);
    expect((await save(cookie)).statusCode).toBe(status);
  }

  expect(
    (
      await app.inject({
        url: '/api/auth/me',
        headers: { cookie: member.cookie },
      })
    ).statusCode,
  ).toBe(200);
});

it.each([
  { days: monday.slice(1) },
  { days: monday.map((day) => ({ ...day, dayOfWeek: 1 })) },
  {
    days: monday.map((day) =>
      day.dayOfWeek === 1 ? { ...day, startTime: '18:00' } : day,
    ),
  },
  {
    days: monday.map((day) =>
      day.dayOfWeek === 1 ? { ...day, endTime: null } : day,
    ),
  },
  {
    days: monday.map((day) =>
      day.dayOfWeek === 1 ? { ...day, endTime: '09:49' } : day,
    ),
  },
  {
    days: monday.map((day) =>
      day.dayOfWeek === 1 ? { ...day, endTime: '24:00' } : day,
    ),
  },
])(
  'rejects invalid weeks without changing persisted hours: %j',
  async (body) => {
    const user = await signup();
    await save(user.cookie);
    expect((await save(user.cookie, body)).statusCode).toBe(400);
    expect(await createAvailabilityStore(fixture.sql).getWeek(user.id)).toEqual(
      monday,
    );
  },
);

it('protects availability writes against cross-origin requests', async () => {
  const user = await signup();
  const result = await app.inject({
    method: 'PUT',
    url: '/api/professional/availability',
    headers: {
      ...headers,
      cookie: user.cookie,
      origin: 'https://other.example',
    },
    payload: { days: monday },
  });
  expect(result.statusCode).toBe(403);
});

it('rolls back the entire replacement if an insert fails', async () => {
  const user = await signup();
  await save(user.cookie);
  const broken: SqlDatabase = {
    query: fixture.sql.query,
    transaction: (run) =>
      fixture.sql.transaction((db) =>
        run({
          query: async (query, values) => {
            if (query.startsWith('INSERT INTO professional_availability'))
              throw new Error('Simulated database failure');

            return db.query(query, values);
          },
        }),
      ),
  };
  await expect(
    createAvailabilityStore(broken).replaceWeek(user.id, monday),
  ).rejects.toThrow('Simulated database failure');
  expect(await createAvailabilityStore(fixture.sql).getWeek(user.id)).toEqual(
    monday,
  );
});

it('database constraints reject invalid ranges and duplicate weekday rows', async () => {
  const user = await signup();
  await save(user.cookie);
  await expect(
    fixture.database.query(
      'INSERT INTO professional_availability VALUES ($1, 8, 540, 1020)',
      [user.id],
    ),
  ).rejects.toThrow();
  await expect(
    fixture.database.query(
      'INSERT INTO professional_availability VALUES ($1, 2, 540, 550)',
      [user.id],
    ),
  ).rejects.toThrow();
  await expect(
    fixture.database.query(
      'INSERT INTO professional_availability VALUES ($1, 1, 540, 1020)',
      [user.id],
    ),
  ).rejects.toThrow();
});

function blockDate(cookie: string, body: unknown, extra = headers) {
  return app.inject({
    method: 'POST',
    url: '/api/professional/blocked-dates',
    headers: { ...extra, cookie },
    payload: body,
  });
}

function listBlocked(cookie: string) {
  return app.inject({
    url: '/api/professional/blocked-dates',
    headers: { cookie },
  });
}

it('blocks a date idempotently, persists it across restart, and unblocks it', async () => {
  const user = await signup();
  expect(await listBlocked(user.cookie).then((r) => r.json())).toEqual({
    timezone: 'Asia/Singapore',
    dates: [],
  });
  const first = await blockDate(user.cookie, { date: '2026-11-09' });
  expect(first.statusCode).toBe(201);
  expect(first.json()).toEqual({
    timezone: 'Asia/Singapore',
    dates: [{ date: '2026-11-09', confirmedSessions: 0 }],
  });
  expect(
    (await blockDate(user.cookie, { date: '2026-11-09' })).statusCode,
  ).toBe(200);
  await blockDate(user.cookie, { date: '2026-11-03' });
  await app.close();
  app = makeApp();
  expect(
    (await listBlocked(user.cookie).then((r) => r.json())).dates.map(
      (entry: { date: string }) => entry.date,
    ),
  ).toEqual(['2026-11-03', '2026-11-09']);
  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/professional/blocked-dates/2026-11-09',
    headers: { ...headers, cookie: user.cookie },
  });
  expect(removed.statusCode).toBe(200);
  expect(removed.json().dates).toEqual([
    { date: '2026-11-03', confirmedSessions: 0 },
  ]);
  const again = await app.inject({
    method: 'DELETE',
    url: '/api/professional/blocked-dates/2026-11-09',
    headers: { ...headers, cookie: user.cookie },
  });
  expect(again.statusCode).toBe(200);
});

it('rejects invalid, past, distant, and unexpected blocked-date input', async () => {
  const user = await signup();
  // The professional's local today is 2026-11-02 at the fixed test clock.
  for (const body of [
    { date: '2026-11-01' },
    { date: '2026-02-30' },
    { date: '2027-11-03' },
    { date: 'next friday' },
    { date: '2026-11-09', professionalId: 'someone-else' },
    {},
  ])
    expect((await blockDate(user.cookie, body)).statusCode).toBe(400);

  expect(
    (await blockDate(user.cookie, { date: '2026-11-02' })).statusCode,
  ).toBe(201);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/professional/blocked-dates/not-a-date',
        headers: { ...headers, cookie: user.cookie },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await listBlocked(user.cookie).then((r) => r.json())).dates,
  ).toHaveLength(1);
});

it('requires a logged-in professional and CSRF headers for blocked dates', async () => {
  const professional = await signup();
  const member = await signup('member', 'member@example.test');
  expect(
    (await app.inject({ url: '/api/professional/blocked-dates' })).statusCode,
  ).toBe(401);
  expect((await listBlocked(member.cookie)).statusCode).toBe(403);
  expect(
    (await blockDate(member.cookie, { date: '2026-11-09' })).statusCode,
  ).toBe(403);
  expect(
    (
      await blockDate(
        professional.cookie,
        { date: '2026-11-09' },
        {} as typeof headers,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/professional/blocked-dates/2026-11-09',
        headers: { cookie: professional.cookie },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await listBlocked(professional.cookie).then((r) => r.json())).dates,
  ).toEqual([]);
});

it("keeps each professional's blocked dates private to them", async () => {
  const first = await signup('professional', 'first@example.test');
  const second = await signup('professional', 'second@example.test');
  await blockDate(first.cookie, { date: '2026-11-09' });
  expect(
    (await listBlocked(second.cookie).then((r) => r.json())).dates,
  ).toEqual([]);
  // Removing a date that belongs to another professional changes nothing.
  await app.inject({
    method: 'DELETE',
    url: '/api/professional/blocked-dates/2026-11-09',
    headers: { ...headers, cookie: second.cookie },
  });
  expect(
    (await listBlocked(first.cookie).then((r) => r.json())).dates,
  ).toHaveLength(1);
});

it('removes a blocked date from the professional slot preview and restores it on unblock', async () => {
  const user = await signup();
  await save(user.cookie);
  const preview = async () =>
    (
      await app.inject({
        url: '/api/professional/availability/slots',
        headers: { cookie: user.cookie },
      })
    ).json().slots as { startsAt: string }[];
  expect(await preview()).toHaveLength(31);
  await blockDate(user.cookie, { date: '2026-11-09' });
  const blocked = await preview();
  expect(blocked).toHaveLength(23);
  // Monday 2026-11-09 09:00 Singapore time is 01:00 UTC the same day.
  expect(blocked.some((slot) => slot.startsAt.startsWith('2026-11-09'))).toBe(
    false,
  );
  await app.inject({
    method: 'DELETE',
    url: '/api/professional/blocked-dates/2026-11-09',
    headers: { ...headers, cookie: user.cookie },
  });
  expect(await preview()).toHaveLength(31);
});
