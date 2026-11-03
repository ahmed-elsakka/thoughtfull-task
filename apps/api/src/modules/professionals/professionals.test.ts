import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createAuthStore, createProfessionalStore } from '@thoughtfull/db';
import { createTestDatabase } from '../../../../../tests/support/database.js';
import { buildApp } from '../../app.js';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;

async function user(name: string, role: 'member' | 'professional') {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await createAuthStore(fixture.sql).createUser(
    {
      id,
      name,
      role,
      email: `${id}@example.test`,
      timezone: 'Asia/Singapore',
      passwordHash: 'test-fixture-not-used-for-login',
    },
    { userId: id, tokenHash, expiresAt: new Date('2099-01-01T00:00:00Z') },
  );

  return { id, cookie: `thoughtfull_session=${token}` };
}

beforeAll(async () => {
  fixture = await createTestDatabase();
}, 30_000);

beforeEach(async () => {
  await fixture.database.exec(
    'TRUNCATE booking_reminders, bookings, professional_availability, auth_sessions, users',
  );
  app = buildApp({
    logger: false,
    auth: {
      store: createAuthStore(fixture.sql),
      origin: 'http://127.0.0.1:5173',
      secureCookies: false,
    },
    professionals: createProfessionalStore(fixture.sql),
  });
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await fixture.database.close();
});

it('lists professionals alphabetically, including those without working hours, and excludes members', async () => {
  const member = await user('Member', 'member');
  const z = await user('Zoe Example', 'professional');
  const a = await user('Alex Example', 'professional');
  const result = await app.inject({
    url: '/api/professionals',
    headers: { cookie: member.cookie },
  });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual({
    professionals: [
      { id: a.id, name: 'Alex Example', timezone: 'Asia/Singapore' },
      { id: z.id, name: 'Zoe Example', timezone: 'Asia/Singapore' },
    ],
    nextPage: null,
  });
});

it('returns a professional profile with only public fields', async () => {
  const member = await user('Member', 'member');
  const professional = await user('Example Professional', 'professional');
  const result = await app.inject({
    url: `/api/professionals/${professional.id}`,
    headers: { cookie: member.cookie },
  });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual({
    professional: {
      id: professional.id,
      name: 'Example Professional',
      timezone: 'Asia/Singapore',
    },
  });
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.body).not.toContain('password');
  expect(result.body).not.toContain('email');
  expect(result.body).not.toContain('session');
});

it('returns an empty list when no professionals exist', async () => {
  const member = await user('Member', 'member');
  const result = await app.inject({
    url: '/api/professionals',
    headers: { cookie: member.cookie },
  });
  expect(result.json()).toEqual({ professionals: [], nextPage: null });
});

it('returns the same 404 for a missing ID and a member ID', async () => {
  const member = await user('Member', 'member');

  for (const id of [randomUUID(), member.id]) {
    const result = await app.inject({
      url: `/api/professionals/${id}`,
      headers: { cookie: member.cookie },
    });
    expect(result.statusCode).toBe(404);
    expect(result.json()).toEqual({ message: 'Professional not found.' });
  }
});

it('requires a member session for both endpoints, ignoring forged identity headers', async () => {
  const professional = await user('Example Professional', 'professional');

  for (const path of [
    '/api/professionals',
    `/api/professionals/${professional.id}`,
  ]) {
    expect(
      (
        await app.inject({
          url: path,
          headers: { 'x-user-id': professional.id },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: path,
          headers: { cookie: professional.cookie },
        })
      ).statusCode,
    ).toBe(403);
  }

  expect(
    (
      await app.inject({
        url: '/api/auth/me',
        headers: { cookie: professional.cookie },
      })
    ).statusCode,
  ).toBe(200);
});

it('rejects malformed profile IDs and pagination inputs', async () => {
  const member = await user('Member', 'member');

  for (const path of [
    '/api/professionals/not-a-uuid',
    '/api/professionals?page=0',
    '/api/professionals?page=-1',
    '/api/professionals?page=1.5',
    '/api/professionals?page=1000000',
    '/api/professionals?role=member',
  ]) {
    expect(
      (await app.inject({ url: path, headers: { cookie: member.cookie } }))
        .statusCode,
    ).toBe(400);
  }
});

it('paginates deterministically without overlap, even when names match', async () => {
  const member = await user('Member', 'member');

  for (let i = 0; i < 23; i++) await user('Same Name', 'professional');

  const first = (
    await app.inject({
      url: '/api/professionals?page=1',
      headers: { cookie: member.cookie },
    })
  ).json();
  const second = (
    await app.inject({
      url: '/api/professionals?page=2',
      headers: { cookie: member.cookie },
    })
  ).json();
  expect(first.professionals).toHaveLength(20);
  expect(first.nextPage).toBe(2);
  expect(second.professionals).toHaveLength(3);
  expect(second.nextPage).toBeNull();
  expect(
    new Set(
      [...first.professionals, ...second.professionals].map(
        (p: { id: string }) => p.id,
      ),
    ).size,
  ).toBe(23);
});

it('response schemas strip private fields even if a future repository returns them', async () => {
  const member = await user('Member', 'member');
  await app.close();
  const exposed = {
    id: randomUUID(),
    name: 'Example',
    timezone: 'UTC',
    email: 'private@example.test',
    passwordHash: 'private',
    sessions: [],
  };
  app = buildApp({
    logger: false,
    auth: {
      store: createAuthStore(fixture.sql),
      origin: 'http://127.0.0.1:5173',
      secureCookies: false,
    },
    professionals: {
      list: async () => ({ professionals: [exposed], nextPage: null }),
      find: async () => exposed,
    },
  });

  for (const path of [
    '/api/professionals',
    `/api/professionals/${exposed.id}`,
  ]) {
    const result = await app.inject({
      url: path,
      headers: { cookie: member.cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toContain('private');
    expect(result.body).not.toContain('sessions');
  }
});
