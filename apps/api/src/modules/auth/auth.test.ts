import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createAuthStore, type SqlDatabase } from '@thoughtfull/db';
import { buildApp } from '../../app.js';
import { tokenHash } from './routes.js';

const headers = {
  origin: 'http://127.0.0.1:5173',
  'x-requested-with': 'ThoughtFull',
};
const signup = {
  name: 'Sample Member',
  email: 'member@example.test',
  password: 'a long example passphrase',
  role: 'member',
  timezone: 'Africa/Cairo',
};
let database: PGlite;
let sql: SqlDatabase;
let clock = new Date('2026-11-03T12:00:00Z');

const makeApp = (secureCookies = false) =>
  buildApp({
    logger: false,
    auth: {
      store: createAuthStore(sql),
      origin: headers.origin,
      secureCookies,
      now: () => clock,
    },
  });

let app: ReturnType<typeof makeApp>;

const cookie = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]!;

const post = (url: string, payload: unknown, session?: string) =>
  app.inject({
    method: 'POST',
    url,
    payload,
    headers: { ...headers, ...(session ? { cookie: session } : {}) },
  });

beforeAll(async () => {
  database = new PGlite();

  await database.exec(
    await readFile(
      new URL(
        '../../../../../packages/db/migrations/0000_tough_kingpin.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );

  sql = {
    query: (query, values) => database.query(query, values),
    transaction: (run) =>
      database.transaction((tx) =>
        run({ query: (query, values) => tx.query(query, values) }),
      ),
  };
}, 30000);

beforeEach(async () => {
  await database.exec('TRUNCATE auth_sessions, users');
  clock = new Date('2026-11-03T12:00:00Z');
  app = makeApp();
});

afterAll(async () => {
  await database.close();
});

// Each test closes its app, including failing assertions.
import { afterEach } from 'vitest';

afterEach(async () => {
  await app.close();
});

describe('persistent authentication', () => {
  it.each(['member', 'professional'])(
    'signs up a %s and returns only public account fields',
    async (role) => {
      const response = await post('/api/auth/signup', {
        ...signup,
        role,
        email: 'MEMBER@example.test',
      });
      expect(response.statusCode).toBe(201);

      expect(response.json().user).toMatchObject({
        name: signup.name,
        email: signup.email,
        role,
        timezone: 'Africa/Cairo',
      });

      expect(Object.keys(response.json().user).sort()).toEqual([
        'email',
        'id',
        'name',
        'role',
        'timezone',
      ]);

      const setCookie = String(response.headers['set-cookie']);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Max-Age=604800');
      const me = await app.inject({
        url: '/api/auth/me',
        headers: { cookie: cookie(response) },
      });
      expect(me.json()).toEqual(response.json());
      const result = await database.query<{ password_hash: string }>(
        'SELECT password_hash FROM users',
      );
      expect(result.rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
      expect(result.rows[0]!.password_hash).not.toContain(signup.password);
      const sessions = await database.query<{ token_hash: string }>(
        'SELECT token_hash FROM auth_sessions',
      );
      const token = cookie(response).split('=')[1]!;
      expect(sessions.rows[0]!.token_hash).toBe(tokenHash(token));
      expect(sessions.rows[0]!.token_hash).not.toBe(token);
    },
  );

  it('logs out, rejects a replayed cookie, and logs in with a new session', async () => {
    const created = await post('/api/auth/signup', signup);
    const old = cookie(created);
    expect((await post('/api/auth/logout', {}, old)).statusCode).toBe(204);

    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: old } }))
        .statusCode,
    ).toBe(401);

    const login = await post('/api/auth/login', {
      email: signup.email.toUpperCase(),
      password: signup.password,
    });
    expect(login.statusCode).toBe(200);
    expect(cookie(login)).not.toBe(old);

    expect(
      (
        await app.inject({
          url: '/api/auth/me',
          headers: { cookie: cookie(login) },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('keeps sessions across API restart and expires them at the exact boundary', async () => {
    const created = await post('/api/auth/signup', signup);
    const session = cookie(created);
    await app.close();
    app = makeApp();

    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: session } }))
        .statusCode,
    ).toBe(200);

    clock = new Date(clock.getTime() + 7 * 24 * 60 * 60 * 1000);

    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: session } }))
        .statusCode,
    ).toBe(401);
  });

  it('rejects normalized duplicate emails at the database constraint', async () => {
    expect((await post('/api/auth/signup', signup)).statusCode).toBe(201);

    expect(
      (
        await post('/api/auth/signup', {
          ...signup,
          email: signup.email.toUpperCase(),
        })
      ).statusCode,
    ).toBe(409);

    expect((await database.query('SELECT * FROM users')).rows).toHaveLength(1);

    expect(
      (await database.query('SELECT * FROM auth_sessions')).rows,
    ).toHaveLength(1);
  });

  it('uses the same error for an unknown email and incorrect password', async () => {
    await post('/api/auth/signup', signup);
    const wrong = await post('/api/auth/login', {
      email: signup.email,
      password: 'incorrect',
    });
    const unknown = await post('/api/auth/login', {
      email: 'unknown@example.test',
      password: 'incorrect',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it.each([
    { timezone: 'Mars/Olympus' },
    { timezone: '+02:00' },
    { role: 'admin' },
    { name: '   ' },
    { password: 'short' },
    { email: 'invalid' },
    { userId: 'forged' },
  ])('validates signup fields: %j', async (override) => {
    expect(
      (await post('/api/auth/signup', { ...signup, ...override })).statusCode,
    ).toBe(400);

    expect((await database.query('SELECT * FROM users')).rows).toHaveLength(0);
  });

  it('never trusts user IDs or forged cookies', async () => {
    const created = await post('/api/auth/signup', signup);

    expect(
      (
        await app.inject({
          url: `/api/auth/me?userId=${created.json().user.id}`,
          headers: { 'x-user-id': created.json().user.id },
        })
      ).statusCode,
    ).toBe(401);

    expect(
      (
        await app.inject({
          url: '/api/auth/me',
          headers: { cookie: 'thoughtfull_session=' + 'a'.repeat(64) },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('blocks cross-origin and headerless writes', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/signup',
          payload: signup,
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/signup',
          payload: signup,
          headers: { ...headers, origin: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('rotates the existing session on login', async () => {
    const created = await post('/api/auth/signup', signup);
    const old = cookie(created);
    const loggedIn = await post(
      '/api/auth/login',
      { email: signup.email, password: signup.password },
      old,
    );
    expect(loggedIn.statusCode).toBe(200);

    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: old } }))
        .statusCode,
    ).toBe(401);
  });

  it('sets Secure on production cookies', async () => {
    await app.close();
    app = makeApp(true);
    const created = await post('/api/auth/signup', signup);
    expect(String(created.headers['set-cookie'])).toContain('Secure');
  });

  it('limits repeated login attempts', async () => {
    for (let i = 0; i < 10; i++)
      expect(
        (
          await post('/api/auth/login', {
            email: signup.email,
            password: 'invalid',
          })
        ).statusCode,
      ).toBe(401);

    expect(
      (
        await post('/api/auth/login', {
          email: signup.email,
          password: 'invalid',
        })
      ).statusCode,
    ).toBe(429);
  });

  it('rolls back user creation if its session cannot be persisted', async () => {
    const created = await post('/api/auth/signup', signup);
    const existing = (
      await database.query<{ token_hash: string }>(
        'SELECT token_hash FROM auth_sessions',
      )
    ).rows[0]!.token_hash;

    await expect(
      createAuthStore(sql).createUser(
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Other',
          email: 'other@example.test',
          role: 'member',
          timezone: 'UTC',
          passwordHash: 'test-only',
        },
        {
          tokenHash: existing,
          userId: created.json().user.id,
          expiresAt: new Date(),
        },
      ),
    ).rejects.toThrow();

    expect((await database.query('SELECT * FROM users')).rows).toHaveLength(1);
  });
});
