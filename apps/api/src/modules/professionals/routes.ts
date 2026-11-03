import type { FastifyInstance } from 'fastify';
import type { ProfessionalStore } from '@thoughtfull/db';

const profileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'timezone'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    timezone: { type: 'string' },
  },
};

export async function registerProfessionals(
  app: FastifyInstance,
  store: ProfessionalStore,
) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.user)
      return reply.code(401).send({ message: 'Please log in.' });

    if (request.user.role !== 'member')
      return reply
        .code(403)
        .send({ message: 'Only members can browse professionals.' });
  });

  app.get<{ Querystring: { page?: string } }>(
    '/api/professionals',
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
            required: ['professionals', 'nextPage'],
            properties: {
              professionals: { type: 'array', items: profileSchema },
              nextPage: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            },
          },
        },
      },
    },
    async (request) => store.list(Number(request.query.page ?? '1')),
  );

  app.get<{ Params: { id: string } }>(
    '/api/professionals/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['professional'],
            properties: { professional: profileSchema },
          },
        },
      },
    },
    async (request, reply) => {
      const professional = await store.find(request.params.id);

      if (!professional)
        return reply.code(404).send({ message: 'Professional not found.' });

      return { professional };
    },
  );
}
