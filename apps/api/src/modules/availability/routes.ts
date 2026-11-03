import type { FastifyInstance } from 'fastify';
import type { AvailabilityStore, BookingStore } from '@thoughtfull/db';
import {
  generateAvailabilitySlots,
  validateWorkingDays,
  type WorkingDay,
} from '@thoughtfull/shared';

const timeSchema = {
  anyOf: [
    { type: 'null' },
    { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  ],
};
const weekSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['days'],
  properties: {
    days: {
      type: 'array',
      minItems: 7,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dayOfWeek', 'startTime', 'endTime'],
        properties: {
          dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 },
          startTime: timeSchema,
          endTime: timeSchema,
        },
      },
    },
  },
};

export async function registerAvailability(
  app: FastifyInstance,
  store: AvailabilityStore,
  now = () => new Date(),
  bookings?: BookingStore,
) {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.user)
      return reply.code(401).send({ message: 'Please log in.' });

    if (request.user.role !== 'professional')
      return reply
        .code(403)
        .send({ message: 'Only professionals can manage working hours.' });
  });

  app.get('/api/professional/availability', async (request) => {
    const user = request.user!;

    return { timezone: user.timezone, days: await store.getWeek(user.id) };
  });

  app.put<{ Body: { days: WorkingDay[] } }>(
    '/api/professional/availability',
    { schema: { body: weekSchema } },
    async (request, reply) => {
      const error = validateWorkingDays(request.body.days);

      if (error) return reply.code(400).send({ message: error });

      const user = request.user!;
      await store.replaceWeek(user.id, request.body.days);

      return {
        timezone: user.timezone,
        days: [...request.body.days].sort((a, b) => a.dayOfWeek - b.dayOfWeek),
      };
    },
  );

  app.get('/api/professional/availability/slots', async (request) => {
    const user = request.user!;
    const days = await store.getWeek(user.id);

    const preview = generateAvailabilitySlots(
      days,
      user.timezone,
      now().toISOString(),
    );

    return bookings
      ? bookings.freeProfessionalSlots(user.id, preview)
      : preview;
  });
}
