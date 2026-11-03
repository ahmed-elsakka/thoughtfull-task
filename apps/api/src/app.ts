import { registerBookings } from './modules/sessions/routes.js';
import type { BookingStore } from '@thoughtfull/db';
import Fastify, { type FastifyError } from 'fastify';
import { registerProfessionals } from './modules/professionals/routes.js';
import type { ProfessionalStore } from '@thoughtfull/db';
import type { AvailabilityStore } from '@thoughtfull/db';
import { registerAvailability } from './modules/availability/routes.js';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { registerAuth, type AuthOptions } from './modules/auth/routes.js';

export function buildApp(
  options: {
    logger?: boolean;
    auth?: AuthOptions;
    availability?: AvailabilityStore;
    professionals?: ProfessionalStore;
    bookings?: BookingStore;
  } = {},
) {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers.set-cookie',
            ],
          },
    bodyLimit: 16384,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  app.register(cookie);
  app.register(rateLimit, { global: false });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.validation)
      return reply
        .code(400)
        .send({ message: 'Check the submitted fields and try again.' });

    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({
        message:
          error.statusCode === 429
            ? 'Too many attempts. Please try again in a minute.'
            : 'Invalid request.',
      });

    request.log.error({ err: error }, 'Request failed');

    return reply
      .code(500)
      .send({ message: 'Something went wrong. Please try again.' });
  });

  if (options.auth) {
    app.register(async (instance) => {
      await registerAuth(instance, options.auth!);

      if (options.bookings) {
        instance.register(async (child) =>
          registerBookings(child, options.bookings!, options.auth?.now),
        );
      }

      if (options.professionals) {
        instance.register(async (child) =>
          registerProfessionals(child, options.professionals!),
        );
      }

      if (options.availability) {
        instance.register(async (child) =>
          registerAvailability(
            child,
            options.availability!,
            options.auth?.now,
            options.bookings,
          ),
        );
      }
    });
  }

  app.get('/api/health', async () => ({ status: 'ok' }));

  return app;
}
