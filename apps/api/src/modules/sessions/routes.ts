import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  BookingConflictError,
  BookingInputError,
  ProfessionalNotFoundError,
  type BookingStore,
} from '@thoughtfull/db';
import type { BookingRequest } from '@thoughtfull/shared';

const uuid = { type: 'string', format: 'uuid' };
const bookingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'professionalId', 'startsAt', 'endsAt', 'status'],
  properties: {
    id: uuid,
    professionalId: uuid,
    startsAt: { type: 'string' },
    endsAt: { type: 'string' },
    status: { type: 'string', enum: ['confirmed', 'cancelled'] },
  },
};

function handleBookingError(error: unknown, reply: FastifyReply) {
  if (error instanceof ProfessionalNotFoundError)
    return reply.code(404).send({ message: 'Professional not found.' });
  if (error instanceof BookingConflictError)
    return reply.code(409).send({ message: error.message });
  if (error instanceof BookingInputError)
    return reply.code(400).send({ message: error.message });

  throw error;
}

export async function registerBookings(
  app: FastifyInstance,
  store: BookingStore,
  now = () => new Date(),
) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.user)
      return reply.code(401).send({ message: 'Please log in.' });
    if (request.user.role !== 'member')
      return reply
        .code(403)
        .send({ message: 'Only members can book sessions.' });
  });

  app.get<{ Params: { id: string } }>(
    '/api/professionals/:id/slots',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: uuid } },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['timezone', 'fromDate', 'toDateExclusive', 'slots'],
            properties: {
              timezone: { type: 'string' },
              fromDate: { type: 'string' },
              toDateExclusive: { type: 'string' },
              slots: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['startsAt', 'endsAt'],
                  properties: {
                    startsAt: { type: 'string' },
                    endsAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await store.calendar(request.user!.id, request.params.id, now());
      } catch (error) {
        return handleBookingError(error, reply);
      }
    },
  );

  const resultSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['booking', 'replayed'],
    properties: { booking: bookingSchema, replayed: { type: 'boolean' } },
  };

  app.post<{ Body: BookingRequest }>(
    '/api/bookings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['professionalId', 'startsAt', 'requestId'],
          properties: {
            professionalId: uuid,
            requestId: uuid,
            startsAt: { type: 'string', format: 'date-time' },
          },
        },
        response: { 200: resultSchema, 201: resultSchema },
      },
    },
    async (request, reply) => {
      try {
        const result = await store.book(request.user!.id, request.body, now);

        return reply.code(result.replayed ? 200 : 201).send(result);
      } catch (error) {
        return handleBookingError(error, reply);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/bookings/:id',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: uuid } },
        response: {
          200: { type: 'object', properties: { booking: bookingSchema } },
        },
      },
    },
    async (request, reply) => {
      const booking = await store.find(request.user!.id, request.params.id);

      if (!booking)
        return reply.code(404).send({ message: 'Booking not found.' });

      return { booking };
    },
  );
}
