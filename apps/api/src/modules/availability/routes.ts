import type { FastifyInstance } from 'fastify';
import type { AvailabilityStore, BookingStore } from '@thoughtfull/db';
import {
  MIN_BOOKING_NOTICE_MINUTES,
  generateAvailabilitySlots,
  todayInTimezone,
  validateBlockedDate,
  validateWorkingDays,
  type BlockedDates,
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

const datePattern = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
const blockedDateBody = {
  type: 'object',
  additionalProperties: false,
  required: ['date'],
  properties: { date: { type: 'string', pattern: datePattern } },
};
const blockedDateParams = {
  type: 'object',
  required: ['date'],
  properties: { date: { type: 'string', pattern: datePattern } },
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

  async function blockedDatesFor(user: {
    id: string;
    timezone: string;
  }): Promise<BlockedDates> {
    return {
      timezone: user.timezone,
      dates: await store.listBlockedDates(
        user.id,
        todayInTimezone(now(), user.timezone),
      ),
    };
  }

  app.get('/api/professional/blocked-dates', async (request) =>
    blockedDatesFor(request.user!),
  );

  app.post<{ Body: { date: string } }>(
    '/api/professional/blocked-dates',
    { schema: { body: blockedDateBody } },
    async (request, reply) => {
      const user = request.user!;
      const error = validateBlockedDate(
        request.body.date,
        todayInTimezone(now(), user.timezone),
      );

      if (error) return reply.code(400).send({ message: error });

      const added = await store.blockDate(user.id, request.body.date);

      // Idempotent: blocking an already blocked date succeeds with 200.
      return reply.code(added ? 201 : 200).send(await blockedDatesFor(user));
    },
  );

  app.delete<{ Params: { date: string } }>(
    '/api/professional/blocked-dates/:date',
    { schema: { params: blockedDateParams } },
    async (request, reply) => {
      const user = request.user!;
      // Past dates cannot be listed or restored, so only validate the format here.
      const error = validateBlockedDate(
        request.params.date,
        request.params.date,
      );

      if (error) return reply.code(400).send({ message: error });

      await store.unblockDate(user.id, request.params.date);

      return blockedDatesFor(user);
    },
  );

  app.get('/api/professional/availability/slots', async (request) => {
    const user = request.user!;
    const days = await store.getWeek(user.id);
    const blocked = await store.listBlockedDates(
      user.id,
      todayInTimezone(now(), user.timezone),
    );

    const preview = generateAvailabilitySlots(
      days,
      user.timezone,
      now().toISOString(),
      user.timezone,
      blocked.map((entry) => entry.date),
      MIN_BOOKING_NOTICE_MINUTES,
    );

    return bookings
      ? bookings.freeProfessionalSlots(user.id, preview)
      : preview;
  });
}
