import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  EmailTakenError,
  type AuthStore,
  type AuthUser,
} from '@thoughtfull/db';
import { hashPassword, verifyPassword } from './password.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const COOKIE = 'thoughtfull_session';
const TTL_SECONDS = 7 * 24 * 60 * 60;

const publicUser = ({
  id,
  name,
  email,
  role,
  timezone,
}: AuthUser): AuthUser => ({ id, name, email, role, timezone });

export interface AuthOptions {
  store: AuthStore;
  origin: string;
  secureCookies: boolean;
  now?: () => Date;
}

export async function registerAuth(app: FastifyInstance, options: AuthOptions) {
  const { store, origin, secureCookies } = options;
  const now = options.now ?? (() => new Date());
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax' as const,
    path: '/',
  };
  // A real hash ensures unknown accounts also incur password verification work.
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));

  const getToken = (request: FastifyRequest) => {
    const token = request.cookies[COOKIE];

    return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
  };

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers.origin !== origin ||
        request.headers['x-requested-with'] !== 'ThoughtFull'
      ) {
        return reply
          .code(403)
          .send({ message: 'Request origin is not allowed.' });
      }
    }

    const token = getToken(request);

    if (token) request.user = await store.findSession(tokenHash(token), now());
  });

  const emailSchema = {
    type: 'string',
    minLength: 3,
    maxLength: 254,
    format: 'email',
  };
  const passwordSchema = { type: 'string', minLength: 12, maxLength: 128 };
  const loginSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: emailSchema,
      password: { type: 'string', minLength: 1, maxLength: 128 },
    },
  };
  const signupSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'email', 'password', 'role', 'timezone'],
    properties: {
      email: emailSchema,
      password: passwordSchema,
      name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
      role: { type: 'string', enum: ['member', 'professional'] },
      timezone: { type: 'string', minLength: 1, maxLength: 100 },
    },
  };

  type Login = { email: string; password: string };

  type Signup = Login & {
    name: string;
    role: AuthUser['role'];
    timezone: string;
  };

  const newSession = (userId: string) => {
    const token = randomBytes(32).toString('hex');

    return {
      token,
      session: {
        tokenHash: tokenHash(token),
        userId,
        expiresAt: new Date(now().getTime() + TTL_SECONDS * 1000),
      },
    };
  };

  app.post<{ Body: Signup }>(
    '/api/auth/signup',
    {
      schema: { body: signupSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body;
      let timezone: string;

      try {
        timezone = new Intl.DateTimeFormat('en', {
          timeZone: body.timezone,
        }).resolvedOptions().timeZone;
      } catch {
        return reply
          .code(400)
          .send({ message: 'Choose a valid IANA timezone.' });
      }

      // Reject numeric UTC offsets; retain named zones such as UTC and Africa/Cairo.
      if (/^[+-]/.test(body.timezone))
        return reply
          .code(400)
          .send({ message: 'Choose a named IANA timezone.' });

      const user = {
        id: randomUUID(),
        name: body.name.trim(),
        email: body.email.toLowerCase(),
        role: body.role,
        timezone,
        passwordHash: await hashPassword(body.password),
      };
      const { token, session } = newSession(user.id);

      try {
        await store.createUser(user, session);
      } catch (error) {
        if (error instanceof EmailTakenError)
          return reply
            .code(409)
            .send({ message: 'An account with this email already exists.' });

        throw error;
      }

      return reply
        .code(201)
        .setCookie(COOKIE, token, { ...cookieOptions, maxAge: TTL_SECONDS })
        .send({ user: publicUser(user) });
    },
  );

  app.post<{ Body: Login }>(
    '/api/auth/login',
    {
      schema: { body: loginSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const user = await store.findCredentials(
        request.body.email.toLowerCase(),
      );
      const valid = await verifyPassword(
        user?.passwordHash ?? dummyHash,
        request.body.password,
      );

      if (!user || !valid)
        return reply.code(401).send({ message: 'Invalid email or password.' });

      const { token, session } = newSession(user.id);
      const previous = getToken(request);

      await store.createSession(
        session,
        previous ? tokenHash(previous) : undefined,
      );

      return reply
        .setCookie(COOKIE, token, { ...cookieOptions, maxAge: TTL_SECONDS })
        .send({ user: publicUser(user) });
    },
  );

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user)
      return reply.code(401).send({ message: 'Please log in.' });

    return { user: publicUser(request.user) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = getToken(request);

    if (token) await store.deleteSession(tokenHash(token));

    return reply.clearCookie(COOKIE, cookieOptions).code(204).send();
  });
}
