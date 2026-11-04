import type { FastifyInstance } from 'fastify';
import type { NotificationStore } from '@thoughtfull/db';

export async function registerNotifications(
  app: FastifyInstance,
  store: NotificationStore,
  now = () => new Date(),
) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.user)
      return reply.code(401).send({ message: 'Please log in.' });
  });

  app.get<{ Querystring: { page?: string } }>(
    '/api/notifications',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'string', pattern: '^[1-9][0-9]{0,5}$' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['notifications', 'unreadCount', 'nextPage'],
            properties: {
              unreadCount: { type: 'integer' },
              nextPage: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
              notifications: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'id',
                    'bookingId',
                    'counterpartName',
                    'sessionStartsAt',
                    'offsetMinutes',
                    'scheduledAt',
                    'createdAt',
                    'readAt',
                  ],
                  properties: {
                    id: { type: 'string' },
                    bookingId: { type: 'string' },
                    counterpartName: { type: 'string' },
                    sessionStartsAt: { type: 'string' },
                    offsetMinutes: { type: 'integer', enum: [60, 1440] },
                    scheduledAt: { type: 'string' },
                    createdAt: { type: 'string' },
                    readAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) =>
      store.list(request.user!.id, Number(request.query.page ?? 1)),
  );

  app.patch<{ Params: { id: string }; Body: Record<string, never> }>(
    '/api/notifications/:id/read',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: { type: 'object', additionalProperties: false },
      },
    },
    async (request, reply) => {
      if (!(await store.markRead(request.user!.id, request.params.id, now())))
        return reply.code(404).send({ message: 'Notification not found.' });

      return { message: 'Notification marked as read.' };
    },
  );
}
