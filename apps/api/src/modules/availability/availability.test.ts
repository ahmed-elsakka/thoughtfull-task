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
    'TRUNCATE booking_reminders, bookings, professional_availability, auth_sessions, users',
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
  expect(slots.json().slots).toHaveLength(32);
  expect(slots.json().slots[0]).toEqual({
    startsAt: '2026-11-02T01:00:00Z',
    endsAt: '2026-11-02T01:50:00Z',
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
