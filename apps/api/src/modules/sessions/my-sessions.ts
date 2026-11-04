import type { FastifyInstance } from 'fastify';
import {
  BookingConflictError,
  BookingInputError,
  BookingPolicyError,
  SessionNotFoundError,
  type BookingStore,
} from '@thoughtfull/db';
import type {
  SessionPeriod,
  SessionChangeRequest,
  RescheduleRequest,
} from '@thoughtfull/shared';
import type { FastifyReply } from 'fastify';

function handleChangeError(error: unknown, reply: FastifyReply) {
  if (error instanceof SessionNotFoundError)
    return reply.code(404).send({ message: 'Session not found.' });
  if (error instanceof BookingPolicyError)
    return reply.code(403).send({ message: error.message });
  if (error instanceof BookingConflictError)
    return reply.code(409).send({ message: error.message });
  if (error instanceof BookingInputError)
    return reply.code(400).send({ message: error.message });

  throw error;
}

const sessionParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
};
const instant = { type: 'string', format: 'date-time' };

export async function registerMySessions(
  app: FastifyInstance,
  store: BookingStore,
  now = () => new Date(),
) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.user)
      return reply.code(401).send({ message: 'Please log in.' });
  });

  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/reschedule-slots',
    { schema: { params: sessionParams } },
    async (request, reply) => {
      if (request.user!.role !== 'member')
        return reply
          .code(403)
          .send({ message: 'Only members can reschedule sessions.' });

      try {
        return await store.rescheduleSlots(
          request.user!.id,
          request.params.id,
          now(),
        );
      } catch (error) {
        return handleChangeError(error, reply);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: SessionChangeRequest }>(
    '/api/sessions/:id/cancel',
    {
      schema: {
        params: sessionParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedStartsAt'],
          properties: { expectedStartsAt: instant },
        },
      },
    },
    async (request, reply) => {
      try {
        await store.cancel(
          request.user!.id,
          request.user!.role,
          request.params.id,
          request.body,
          now,
        );

        return { message: 'Session cancelled.' };
      } catch (error) {
        return handleChangeError(error, reply);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: RescheduleRequest }>(
    '/api/sessions/:id/reschedule',
    {
      schema: {
        params: sessionParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedStartsAt', 'startsAt'],
          properties: { expectedStartsAt: instant, startsAt: instant },
        },
      },
    },
    async (request, reply) => {
      if (request.user!.role !== 'member')
        return reply
          .code(403)
          .send({ message: 'Only members can reschedule sessions.' });

      try {
        await store.reschedule(
          request.user!.id,
          request.params.id,
          request.body,
          now,
        );

        return { message: 'Session rescheduled.' };
      } catch (error) {
        return handleChangeError(error, reply);
      }
    },
  );

  app.get<{ Querystring: { period?: SessionPeriod; page?: string } }>(
    '/api/sessions',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            period: { type: 'string', enum: ['upcoming', 'past'] },
            page: { type: 'string', pattern: '^[1-9][0-9]{0,5}$' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['sessions', 'nextPage'],
            properties: {
              nextPage: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
              sessions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'id',
                    'counterpartName',
                    'startsAt',
                    'endsAt',
                    'status',
                  ],
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    counterpartName: { type: 'string' },
                    startsAt: { type: 'string' },
                    endsAt: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: ['confirmed', 'cancelled'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const period = request.query.period ?? 'upcoming';

      if (user.role === 'professional' && period === 'past')
        return reply
          .code(403)
          .send({ message: 'Professionals can view their upcoming schedule.' });

      return store.listSessions(
        user.id,
        user.role,
        period,
        Number(request.query.page ?? 1),
        now(),
      );
    },
  );
}
