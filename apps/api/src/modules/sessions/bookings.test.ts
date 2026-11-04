import { randomUUID, randomBytes, createHash } from 'node:crypto';
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
} from 'vitest';
import {
  createAuthStore,
  createAvailabilityStore,
  createBookingStore,
  type SqlDatabase,
} from '@thoughtfull/db';
import { emptyWeek } from '@thoughtfull/shared';
import { createTestDatabase } from '../../../../../tests/support/database.js';
import { buildApp } from '../../app.js';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let clock = new Date('2026-11-02T00:00:00Z');
const headers = {
  origin: 'http://127.0.0.1:5173',
  'x-requested-with': 'ThoughtFull',
};
const makeApp = () =>
  buildApp({
    logger: false,
    auth: {
      store: createAuthStore(fixture.sql),
      origin: headers.origin,
      secureCookies: false,
      now: () => clock,
    },
    bookings: createBookingStore(fixture.sql),
    availability: createAvailabilityStore(fixture.sql),
  });

async function user(
  role: 'member' | 'professional',
  timezone = 'UTC',
  opening = '09:00',
) {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  await createAuthStore(fixture.sql).createUser(
    {
      id,
      role,
      timezone,
      name: 'Fictional Test',
      email: `${id}@example.test`,
      passwordHash: 'not-used-for-login',
    },
    {
      userId: id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    },
  );

  if (role === 'professional')
    await createAvailabilityStore(fixture.sql).replaceWeek(
      id,
      emptyWeek().map((day) => ({
        ...day,
        startTime: opening,
        endTime: '17:00',
      })),
    );

  return { id, cookie: `thoughtfull_session=${token}` };
}

function book(
  cookie: string,
  professionalId: string,
  startsAt = '2026-11-02T09:00:00Z',
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/bookings',
    headers: { ...headers, cookie },
    payload: { professionalId, startsAt, requestId: randomUUID(), ...extra },
  });
}

function change(
  cookie: string,
  id: string,
  action: 'cancel' | 'reschedule',
  expectedStartsAt: string,
  startsAt = '2026-11-05T10:00:00Z',
) {
  return app.inject({
    method: 'POST',
    url: `/api/sessions/${id}/${action}`,
    headers: { ...headers, cookie },
    payload: {
      expectedStartsAt,
      ...(action === 'reschedule' ? { startsAt } : {}),
    },
  });
}

beforeAll(async () => {
  fixture = await createTestDatabase();
}, 30_000);

beforeEach(async () => {
  await fixture.database.exec(
    'TRUNCATE notifications, booking_reminders, bookings, professional_availability, professional_blocked_dates, auth_sessions, users',
  );
  clock = new Date('2026-11-02T00:00:00Z');
  app = makeApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await fixture.database.close();
});

it.each(['cancel', 'reschedule'] as const)(
  'enforces the exact 24-hour member %s boundary using server time',
  async (action) => {
    const member = await user('member', 'America/New_York');
    const professional = await user('professional');
    const original = (
      await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
    ).json().booking;
    clock = new Date('2026-11-03T09:00:00.001Z');
    const blocked = await change(
      member.cookie,
      original.id,
      action,
      original.startsAt,
    );
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().message).toContain('24 hours');
    expect(
      await createBookingStore(fixture.sql).find(member.id, original.id),
    ).toEqual(original);
    clock = new Date('2026-11-03T09:00:00Z');
    expect(
      (await change(member.cookie, original.id, action, original.startsAt))
        .statusCode,
    ).toBe(200);
  },
);

it('cancels atomically, removes pending reminders, frees the slot, and safely retries', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const original = (
    await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
  ).json().booking;
  expect(
    (await fixture.sql.query('SELECT * FROM booking_reminders')).rows,
  ).toHaveLength(4);
  expect(
    (await change(member.cookie, original.id, 'cancel', original.startsAt))
      .statusCode,
  ).toBe(200);
  expect(
    (await fixture.sql.query('SELECT * FROM booking_reminders')).rows,
  ).toHaveLength(0);
  expect(
    (
      await createBookingStore(fixture.sql).calendar(
        member.id,
        professional.id,
        clock,
      )
    ).slots.some(
      (s) => Date.parse(s.startsAt) === Date.parse(original.startsAt),
    ),
  ).toBe(true);
  clock = new Date('2026-11-04T09:30:00Z');
  expect(
    (await change(member.cookie, original.id, 'cancel', original.startsAt))
      .statusCode,
  ).toBe(200);
  expect(
    (await createBookingStore(fixture.sql).find(member.id, original.id))
      ?.status,
  ).toBe('cancelled');
});

it('allows the owning professional to cancel even after start, but not reschedule', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const original = (await book(member.cookie, professional.id)).json().booking;
  clock = new Date('2026-11-05T09:00:00Z');
  expect(
    (
      await change(
        professional.cookie,
        original.id,
        'reschedule',
        original.startsAt,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await change(
        professional.cookie,
        original.id,
        'cancel',
        original.startsAt,
      )
    ).statusCode,
  ).toBe(200);
});

it('reschedules one existing session and replaces reminders for both participants', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const original = (
    await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
  ).json().booking;
  const previousReminders = (
    await fixture.sql.query<{ id: string }>('SELECT id FROM booking_reminders')
  ).rows;
  const target = '2026-11-02T10:00:00Z';
  expect(
    (
      await change(
        member.cookie,
        original.id,
        'reschedule',
        original.startsAt,
        target,
      )
    ).statusCode,
  ).toBe(200);
  const bookings = (await fixture.sql.query('SELECT * FROM bookings')).rows;
  expect(bookings).toHaveLength(1);
  expect(
    await createBookingStore(fixture.sql).find(member.id, original.id),
  ).toMatchObject({
    id: original.id,
    startsAt: '2026-11-02T10:00:00.000Z',
    endsAt: '2026-11-02T10:50:00.000Z',
  });
  const reminders = (
    await fixture.sql.query<{
      id: string;
      recipient_id: string;
      scheduled_at: Date;
      offset_minutes: number;
    }>('SELECT * FROM booking_reminders')
  ).rows;
  expect(reminders).toHaveLength(2);
  expect(
    reminders.every(
      (r) =>
        r.offset_minutes === 60 &&
        r.scheduled_at.toISOString() === '2026-11-02T09:00:00.000Z',
    ),
  ).toBe(true);
  expect(new Set(reminders.map((r) => r.recipient_id))).toEqual(
    new Set([member.id, professional.id]),
  );
  expect(
    reminders.every((r) => !previousReminders.some((old) => old.id === r.id)),
  ).toBe(true);
  const calendar = await createBookingStore(fixture.sql).calendar(
    member.id,
    professional.id,
    clock,
  );
  expect(
    calendar.slots.some(
      (s) => Date.parse(s.startsAt) === Date.parse(original.startsAt),
    ),
  ).toBe(true);
  expect(
    calendar.slots.some((s) => Date.parse(s.startsAt) === Date.parse(target)),
  ).toBe(false);
  expect(
    (await change(member.cookie, original.id, 'cancel', original.startsAt))
      .statusCode,
  ).toBe(409);
  expect(
    (await change(member.cookie, original.id, 'reschedule', original.startsAt))
      .statusCode,
  ).toBe(409);
});

it.each(['professional', 'member'] as const)(
  'preserves the original booking and reminders on a %s overlap',
  async (conflict) => {
    const member = await user('member');
    const other = await user('member');
    const professional = await user('professional');
    const second = await user('professional');
    const original = (
      await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
    ).json().booking;
    await book(
      conflict === 'member' ? member.cookie : other.cookie,
      conflict === 'member' ? second.id : professional.id,
      '2026-11-05T10:00:00Z',
    );
    const before = (
      await fixture.sql.query('SELECT * FROM booking_reminders ORDER BY id')
    ).rows;
    const result = await change(
      member.cookie,
      original.id,
      'reschedule',
      original.startsAt,
    );
    expect(result.statusCode).toBe(409);
    expect(
      await createBookingStore(fixture.sql).find(member.id, original.id),
    ).toEqual(original);
    expect(
      (await fixture.sql.query('SELECT * FROM booking_reminders ORDER BY id'))
        .rows,
    ).toEqual(before);
  },
);

it('rolls back rescheduling when replacement reminder creation fails', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const original = (
    await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
  ).json().booking;
  const before = (
    await fixture.sql.query('SELECT * FROM booking_reminders ORDER BY id')
  ).rows;
  const broken: SqlDatabase = {
    query: fixture.sql.query,
    transaction: (run) =>
      fixture.sql.transaction((db) =>
        run({
          query: async (sql, values) => {
            if (sql.startsWith('INSERT INTO booking_reminders'))
              throw new Error('reminder failure');

            return db.query(sql, values);
          },
        }),
      ),
  };
  await expect(
    createBookingStore(broken).reschedule(
      member.id,
      original.id,
      { expectedStartsAt: original.startsAt, startsAt: '2026-11-05T10:00:00Z' },
      () => clock,
    ),
  ).rejects.toThrow('reminder failure');
  expect(
    await createBookingStore(fixture.sql).find(member.id, original.id),
  ).toEqual(original);
  expect(
    (await fixture.sql.query('SELECT * FROM booking_reminders ORDER BY id'))
      .rows,
  ).toEqual(before);
});

it('rechecks the member deadline after participant locks and slot generation', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const original = (
    await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
  ).json().booking;
  const times = [
    '2026-11-03T08:59:59Z',
    '2026-11-03T09:00:00Z',
    '2026-11-03T09:00:00.001Z',
  ];
  await expect(
    createBookingStore(fixture.sql).reschedule(
      member.id,
      original.id,
      { expectedStartsAt: original.startsAt, startsAt: '2026-11-05T10:00:00Z' },
      () => new Date(times.shift()!),
    ),
  ).rejects.toThrow('24 hours');
  expect(
    await createBookingStore(fixture.sql).find(member.id, original.id),
  ).toEqual(original);
});

it('validates replacement slots against current hours and permits overlap with only the original session', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const original = (
    await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
  ).json().booking;
  for (const target of [
    '2026-11-01T09:00:00Z',
    '2026-11-05T10:15:00Z',
    '2026-12-05T10:00:00Z',
  ]) {
    expect(
      (
        await change(
          member.cookie,
          original.id,
          'reschedule',
          original.startsAt,
          target,
        )
      ).statusCode,
    ).toBe(400);
  }
  await createAvailabilityStore(fixture.sql).replaceWeek(
    professional.id,
    emptyWeek().map((day) => ({
      ...day,
      startTime: '09:15',
      endTime: '17:00',
    })),
  );
  const slots = await app.inject({
    url: `/api/sessions/${original.id}/reschedule-slots`,
    headers: { cookie: member.cookie },
  });
  expect(slots.statusCode).toBe(200);
  expect(
    slots
      .json()
      .slots.some(
        (s: { startsAt: string }) =>
          Date.parse(s.startsAt) === Date.parse('2026-11-04T09:15:00Z'),
      ),
  ).toBe(true);
  expect(
    (
      await change(
        member.cookie,
        original.id,
        'reschedule',
        original.startsAt,
        '2026-11-04T09:15:00Z',
      )
    ).statusCode,
  ).toBe(200);
});

it('protects session changes against other users, CSRF, and forged fields', async () => {
  const member = await user('member');
  const other = await user('member');
  const professional = await user('professional');
  const otherProfessional = await user('professional');
  const original = (
    await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
  ).json().booking;
  for (const action of ['cancel', 'reschedule'] as const) {
    expect(
      (await change('', original.id, action, original.startsAt)).statusCode,
    ).toBe(401);
    expect(
      (await change(other.cookie, original.id, action, original.startsAt))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/sessions/${original.id}/${action}`,
          headers: { cookie: member.cookie },
          payload: { expectedStartsAt: original.startsAt },
        })
      ).statusCode,
    ).toBe(403);
  }
  expect(
    (
      await change(
        otherProfessional.cookie,
        original.id,
        'cancel',
        original.startsAt,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: `/api/sessions/${original.id}/reschedule-slots`,
        headers: { cookie: other.cookie },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${original.id}/cancel`,
        headers: { ...headers, cookie: member.cookie },
        payload: { expectedStartsAt: original.startsAt, memberId: other.id },
      })
    ).statusCode,
  ).toBe(400);
  await change(member.cookie, original.id, 'cancel', original.startsAt);
  expect(
    (await change(member.cookie, original.id, 'reschedule', original.startsAt))
      .statusCode,
  ).toBe(409);
});

it('returns four member-local weeks, only free slot instants, and no client identities', async () => {
  const member = await user('member', 'America/Los_Angeles');
  const professional = await user('professional', 'Asia/Tokyo');
  const result = await app.inject({
    url: `/api/professionals/${professional.id}/slots`,
    headers: { cookie: member.cookie },
  });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    timezone: 'America/Los_Angeles',
    fromDate: '2026-11-01',
    toDateExclusive: '2026-11-29',
  });
  expect(Object.keys(result.json().slots[0]).sort()).toEqual([
    'endsAt',
    'startsAt',
  ]);
  expect(result.body).not.toContain('Fictional Test');
  expect(result.body).not.toContain('email');
  expect(
    result
      .json()
      .slots.every(
        (s: { startsAt: string }) => Date.parse(s.startsAt) > clock.getTime(),
      ),
  ).toBe(true);
});

it('books for the authenticated member, persists across API restart, and hides the slot', async () => {
  const member = await user('member');
  const other = await user('member');
  const professional = await user('professional');
  const result = await book(member.cookie, professional.id);
  expect(result.statusCode).toBe(201);
  expect(result.json().booking).toMatchObject({
    professionalId: professional.id,
    startsAt: '2026-11-02T09:00:00.000Z',
    endsAt: '2026-11-02T09:50:00.000Z',
    status: 'confirmed',
  });
  await app.close();
  app = makeApp();
  const saved = await app.inject({
    url: `/api/bookings/${result.json().booking.id}`,
    headers: { cookie: member.cookie },
  });
  expect(saved.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        url: `/api/bookings/${result.json().booking.id}`,
        headers: { cookie: other.cookie },
      })
    ).statusCode,
  ).toBe(404);

  for (const cookie of [member.cookie, other.cookie]) {
    const calendar = await app.inject({
      url: `/api/professionals/${professional.id}/slots`,
      headers: { cookie },
    });
    expect(
      calendar
        .json()
        .slots.some(
          (s: { startsAt: string }) => s.startsAt === '2026-11-02T09:00:00Z',
        ),
    ).toBe(false);
  }

  const preview = await app.inject({
    url: '/api/professional/availability/slots',
    headers: { cookie: professional.cookie },
  });
  expect(
    preview
      .json()
      .slots.some(
        (s: { startsAt: string }) => s.startsAt === '2026-11-02T09:00:00Z',
      ),
  ).toBe(false);
});

it('rejects a stale slot and member overlaps across professionals, but permits adjacency', async () => {
  const member = await user('member');
  const other = await user('member');
  const first = await user('professional');
  const second = await user('professional', 'UTC', '09:30');
  const adjacent = await user('professional', 'UTC', '09:50');
  expect((await book(member.cookie, first.id)).statusCode).toBe(201);
  expect((await book(other.cookie, first.id)).statusCode).toBe(409);
  expect(
    (await book(member.cookie, second.id, '2026-11-02T09:30:00Z')).statusCode,
  ).toBe(409);
  const calendar = await app.inject({
    url: `/api/professionals/${second.id}/slots`,
    headers: { cookie: member.cookie },
  });
  expect(
    calendar
      .json()
      .slots.some(
        (s: { startsAt: string }) => s.startsAt === '2026-11-02T09:30:00Z',
      ),
  ).toBe(false);
  expect(
    (await book(member.cookie, adjacent.id, '2026-11-02T09:50:00Z')).statusCode,
  ).toBe(201);
});

it('replays retries without duplicate sessions or reminders, and rejects key reuse for another slot', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const requestId = randomUUID();
  const first = await book(
    member.cookie,
    professional.id,
    '2026-11-04T09:00:00Z',
    { requestId },
  );
  const retry = await book(
    member.cookie,
    professional.id,
    '2026-11-04T09:00:00Z',
    { requestId },
  );
  expect(first.statusCode).toBe(201);
  expect(retry.statusCode).toBe(200);
  expect(retry.json().booking.id).toBe(first.json().booking.id);
  expect(retry.json().replayed).toBe(true);
  expect(
    (await fixture.database.query('SELECT * FROM bookings')).rows,
  ).toHaveLength(1);
  expect(
    (await fixture.database.query('SELECT * FROM booking_reminders')).rows,
  ).toHaveLength(4);
  expect(
    (
      await book(member.cookie, professional.id, '2026-11-04T10:00:00Z', {
        requestId,
      })
    ).statusCode,
  ).toBe(409);
});

it.each([
  '2026-11-01T09:00:00Z',
  '2026-11-02T00:00:00Z',
  '2026-11-02T09:15:00Z',
  '2026-11-02T17:00:00Z',
  '2026-11-30T09:00:00Z',
])(
  'rejects past, off-grid, outside-hours or outside-window time %s',
  async (start) => {
    const member = await user('member');
    const professional = await user('professional');
    expect((await book(member.cookie, professional.id, start)).statusCode).toBe(
      400,
    );
  },
);

it('rechecks availability changes before booking', async () => {
  const member = await user('member');
  const professional = await user('professional');
  await createAvailabilityStore(fixture.sql).replaceWeek(
    professional.id,
    emptyWeek(),
  );
  expect((await book(member.cookie, professional.id)).statusCode).toBe(400);
});

it('checks server time again after acquiring participant locks', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const calls = [
    new Date('2026-11-02T06:59:59Z'),
    new Date('2026-11-02T09:00:00Z'),
  ];
  await expect(
    createBookingStore(fixture.sql).book(
      member.id,
      {
        professionalId: professional.id,
        startsAt: '2026-11-02T09:00:00Z',
        requestId: randomUUID(),
      },
      () => calls.shift()!,
    ),
  ).rejects.toThrow('past');
});

it.each([
  ['2026-11-02T07:00:00Z', 2],
  ['2026-11-01T09:00:01Z', 2],
  ['2026-11-01T09:00:00Z', 4],
])(
  'schedules only unpassed reminders for both people at clock %s',
  async (now, count) => {
    clock = new Date(now);
    const member = await user('member');
    const professional = await user('professional');
    expect((await book(member.cookie, professional.id)).statusCode).toBe(201);
    const reminders = (
      await fixture.database.query<{
        recipient_id: string;
        scheduled_at: Date;
      }>('SELECT * FROM booking_reminders')
    ).rows;
    expect(reminders).toHaveLength(count);
    expect(reminders.every((row) => row.scheduled_at >= clock)).toBe(true);
    if (count)
      expect(new Set(reminders.map((row) => row.recipient_id))).toEqual(
        new Set([member.id, professional.id]),
      );
  },
);

it('rolls back the booking when reminder persistence fails', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const broken: SqlDatabase = {
    query: fixture.sql.query,
    transaction: (run) =>
      fixture.sql.transaction((db) =>
        run({
          query: async (sql, params) => {
            if (sql.startsWith('INSERT INTO booking_reminders'))
              throw new Error('Reminder storage unavailable');

            return db.query(sql, params);
          },
        }),
      ),
  };
  await expect(
    createBookingStore(broken).book(
      member.id,
      {
        professionalId: professional.id,
        startsAt: '2026-11-04T09:00:00Z',
        requestId: randomUUID(),
      },
      () => clock,
    ),
  ).rejects.toThrow('Reminder storage');
  expect(
    (await fixture.database.query('SELECT * FROM bookings')).rows,
  ).toHaveLength(0);
});

it('enforces member access, CSRF, and rejects client identity or duration overrides', async () => {
  const member = await user('member');
  const professional = await user('professional');
  expect((await book('', professional.id)).statusCode).toBe(401);
  expect((await book(professional.cookie, professional.id)).statusCode).toBe(
    403,
  );
  expect(
    (
      await book(member.cookie, professional.id, undefined, {
        memberId: randomUUID(),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await book(member.cookie, professional.id, undefined, {
        endsAt: '2026-11-02T12:00:00Z',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/bookings',
        headers: { cookie: member.cookie },
        payload: {
          professionalId: professional.id,
          startsAt: '2026-11-02T09:00:00Z',
          requestId: randomUUID(),
        },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ url: `/api/professionals/${professional.id}/slots` }))
      .statusCode,
  ).toBe(401);
});

it('returns 404 when the requested professional is missing or a member', async () => {
  const member = await user('member');

  for (const id of [randomUUID(), member.id]) {
    expect((await book(member.cookie, id)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/professionals/${id}/slots`,
          headers: { cookie: member.cookie },
        })
      ).statusCode,
    ).toBe(404);
  }
});

it('lists only the signed-in participant sessions and exposes only the counterpart name', async () => {
  const member = await user('member');
  const other = await user('member');
  const professional = await user('professional');
  const otherProfessional = await user('professional');
  await fixture.sql.query('UPDATE users SET name = $1 WHERE id = $2', [
    'Fictional Member',
    member.id,
  ]);
  await fixture.sql.query('UPDATE users SET name = $1 WHERE id = $2', [
    'Fictional Professional',
    professional.id,
  ]);
  const booked = (await book(member.cookie, professional.id)).json().booking;
  await book(other.cookie, otherProfessional.id);

  for (const [cookie, name] of [
    [member.cookie, 'Fictional Professional'],
    [professional.cookie, 'Fictional Member'],
  ]) {
    const response = await app.inject({
      url: '/api/sessions',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sessions: [
        {
          id: booked.id,
          counterpartName: name,
          startsAt: booked.startsAt,
          endsAt: booked.endsAt,
          status: 'confirmed',
        },
      ],
      nextPage: null,
    });
    expect(response.body).not.toContain('email');
    expect(response.body).not.toContain('password');
    expect(response.body).not.toContain(member.id);
    expect(response.body).not.toContain(professional.id);
  }
});

it('uses end time to separate ongoing and past sessions, with useful ordering', async () => {
  const member = await user('member', 'Pacific/Kiritimati');
  const professional = await user('professional');
  const ids: string[] = [];
  for (const hour of ['09', '10', '11']) {
    ids.push(
      (
        await book(member.cookie, professional.id, `2026-11-02T${hour}:00:00Z`)
      ).json().booking.id,
    );
  }
  clock = new Date('2026-11-02T09:49:59Z');
  const list = async (period: string) =>
    (
      await app.inject({
        url: `/api/sessions?period=${period}`,
        headers: { cookie: member.cookie },
      })
    ).json().sessions;
  expect((await list('upcoming')).map((s: { id: string }) => s.id)).toEqual(
    ids,
  );
  expect(await list('past')).toEqual([]);
  clock = new Date('2026-11-02T10:50:00Z');
  expect((await list('upcoming')).map((s: { id: string }) => s.id)).toEqual([
    ids[2],
  ]);
  expect((await list('past')).map((s: { id: string }) => s.id)).toEqual([
    ids[1],
    ids[0],
  ]);
});

it('paginates schedules without duplicates and excludes cancelled future sessions', async () => {
  const member = await user('member');
  const professional = await user('professional');
  for (let day = 3; day <= 24; day++) {
    await fixture.sql.query(
      'INSERT INTO bookings (id, member_id, professional_id, request_id, starts_at, ends_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        randomUUID(),
        member.id,
        professional.id,
        randomUUID(),
        `2026-11-${day.toString().padStart(2, '0')}T09:00:00Z`,
        `2026-11-${day.toString().padStart(2, '0')}T09:50:00Z`,
        day === 24 ? 'cancelled' : 'confirmed',
      ],
    );
  }
  const list = async (page: number) =>
    (
      await app.inject({
        url: `/api/sessions?page=${page}`,
        headers: { cookie: professional.cookie },
      })
    ).json();
  const first = await list(1);
  const second = await list(2);
  expect(first.sessions).toHaveLength(20);
  expect(first.nextPage).toBe(2);
  expect(second.sessions).toHaveLength(1);
  expect(second.nextPage).toBeNull();
  expect(
    new Set(
      [...first.sessions, ...second.sessions].map((s: { id: string }) => s.id),
    ).size,
  ).toBe(21);
  expect(await list(3)).toEqual({ sessions: [], nextPage: null });
});

it('requires authentication and rejects identity overrides and invalid session filters', async () => {
  const member = await user('member');
  const professional = await user('professional');
  expect((await app.inject({ url: '/api/sessions' })).statusCode).toBe(401);
  for (const query of [
    'memberId=' + professional.id,
    'role=professional',
    'period=invalid',
    'page=0',
    'page=-1',
    'page=1.5',
    'page=1000000',
  ]) {
    expect(
      (
        await app.inject({
          url: `/api/sessions?${query}`,
          headers: { cookie: member.cookie },
        })
      ).statusCode,
    ).toBe(400);
  }
  expect(
    (
      await app.inject({
        url: '/api/sessions?period=past',
        headers: { cookie: professional.cookie },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        url: '/api/sessions',
        headers: { cookie: member.cookie },
      })
    ).json(),
  ).toEqual({ sessions: [], nextPage: null });
});

it('schedules reminders at exact elapsed hours across a daylight-saving change', async () => {
  // US clocks fall back on 2026-11-01 at 02:00 local, so the day before is 25 hours long.
  clock = new Date('2026-10-30T00:00:00Z');
  const member = await user('member', 'America/New_York');
  const professional = await user('professional', 'America/New_York');
  const response = await book(
    member.cookie,
    professional.id,
    '2026-11-01T14:00:00Z',
  );
  expect(response.statusCode).toBe(201);
  const reminders = (
    await fixture.database.query<{
      offset_minutes: number;
      scheduled_at: Date;
    }>('SELECT offset_minutes, scheduled_at FROM booking_reminders')
  ).rows;
  const times = (offset: number) => [
    ...new Set(
      reminders
        .filter((row) => row.offset_minutes === offset)
        .map((row) => row.scheduled_at.toISOString()),
    ),
  ];
  // 09:00 EST session. 24 elapsed hours earlier is 10:00 EDT, not 09:00 wall-clock time.
  expect(times(1440)).toEqual(['2026-10-31T14:00:00.000Z']);
  expect(times(60)).toEqual(['2026-11-01T13:00:00.000Z']);
  expect(reminders).toHaveLength(4);
});

describe('blocked dates', () => {
  const availability = () => createAvailabilityStore(fixture.sql);
  const slotDates = (slots: { startsAt: string }[]) =>
    new Set(slots.map((slot) => slot.startsAt.slice(0, 10)));

  it('hides a blocked date from the member calendar but keeps neighbouring dates', async () => {
    const member = await user('member');
    const professional = await user('professional');
    await availability().blockDate(professional.id, '2026-11-04');
    const calendar = await createBookingStore(fixture.sql).calendar(
      member.id,
      professional.id,
      clock,
    );
    expect(slotDates(calendar.slots).has('2026-11-04')).toBe(false);
    expect(slotDates(calendar.slots).has('2026-11-03')).toBe(true);
    expect(slotDates(calendar.slots).has('2026-11-05')).toBe(true);
  });

  it('rejects booking a blocked date without creating a session or reminders', async () => {
    const member = await user('member');
    const professional = await user('professional');
    await availability().blockDate(professional.id, '2026-11-04');
    const blocked = await book(
      member.cookie,
      professional.id,
      '2026-11-04T10:00:00Z',
    );
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().message).toContain('no longer offered');
    expect(
      (await fixture.database.query('SELECT * FROM bookings')).rows,
    ).toHaveLength(0);
    expect(
      (await fixture.database.query('SELECT * FROM booking_reminders')).rows,
    ).toHaveLength(0);
    expect(
      (await book(member.cookie, professional.id, '2026-11-05T10:00:00Z'))
        .statusCode,
    ).toBe(201);
  });

  it('allows booking again once the date is unblocked', async () => {
    const member = await user('member');
    const professional = await user('professional');
    await availability().blockDate(professional.id, '2026-11-04');
    await availability().unblockDate(professional.id, '2026-11-04');
    expect(
      (await book(member.cookie, professional.id, '2026-11-04T10:00:00Z'))
        .statusCode,
    ).toBe(201);
  });

  it('keeps an existing session on a newly blocked date and reports it', async () => {
    const member = await user('member');
    const professional = await user('professional');
    const original = (
      await book(member.cookie, professional.id, '2026-11-04T10:00:00Z')
    ).json().booking;
    await availability().blockDate(professional.id, '2026-11-04');
    expect(
      await createBookingStore(fixture.sql).find(member.id, original.id),
    ).toEqual(original);
    expect(
      await availability().listBlockedDates(professional.id, '2026-11-02'),
    ).toEqual([{ date: '2026-11-04', confirmedSessions: 1 }]);
    // The professional can still cancel it, which clears the warning count.
    await createBookingStore(fixture.sql).cancel(
      professional.id,
      'professional',
      original.id,
      { expectedStartsAt: original.startsAt },
      () => clock,
    );
    expect(
      await availability().listBlockedDates(professional.id, '2026-11-02'),
    ).toEqual([{ date: '2026-11-04', confirmedSessions: 0 }]);
  });

  it('does not offer or accept a blocked date when rescheduling', async () => {
    const member = await user('member');
    const professional = await user('professional');
    const original = (
      await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
    ).json().booking;
    await availability().blockDate(professional.id, '2026-11-05');
    const offered = await createBookingStore(fixture.sql).rescheduleSlots(
      member.id,
      original.id,
      clock,
    );
    expect(slotDates(offered.slots).has('2026-11-05')).toBe(false);
    expect(slotDates(offered.slots).has('2026-11-06')).toBe(true);
    const rejected = await change(
      member.cookie,
      original.id,
      'reschedule',
      original.startsAt,
      '2026-11-05T10:00:00Z',
    );
    expect(rejected.statusCode).toBe(400);
    expect(
      await createBookingStore(fixture.sql).find(member.id, original.id),
    ).toEqual(original);
    expect(
      (await fixture.database.query('SELECT * FROM booking_reminders')).rows,
    ).toHaveLength(4);
  });

  it('uses the professional-local date when blocking', async () => {
    const member = await user('member');
    // Opening 09:00 in Auckland (UTC+13 in November) is 20:00 UTC the previous day.
    const professional = await user('professional', 'Pacific/Auckland');
    await availability().blockDate(professional.id, '2026-11-05');
    const calendar = await createBookingStore(fixture.sql).calendar(
      member.id,
      professional.id,
      clock,
    );
    const starts = calendar.slots.map((slot) => slot.startsAt);
    expect(starts).not.toContain('2026-11-04T20:00:00Z');
    expect(starts).toContain('2026-11-05T20:00:00Z');
  });
});

describe('minimum booking notice', () => {
  const nearBy = (offsetMs: number) =>
    new Date(Date.parse('2026-11-02T09:00:00Z') - offsetMs);
  const hour = 3_600_000;

  it('allows a start exactly two hours ahead and rejects anything sooner', async () => {
    const member = await user('member');
    const professional = await user('professional');
    clock = nearBy(2 * hour - 1000);
    const early = await book(member.cookie, professional.id);
    expect(early.statusCode).toBe(400);
    expect(early.json().message).toBe(
      'Sessions must be booked at least 2 hours ahead.',
    );
    expect(
      (await fixture.database.query('SELECT * FROM bookings')).rows,
    ).toHaveLength(0);
    clock = nearBy(2 * hour);
    expect((await book(member.cookie, professional.id)).statusCode).toBe(201);
  });

  it('hides slots inside the notice window from the member calendar', async () => {
    const member = await user('member');
    const professional = await user('professional');
    clock = new Date('2026-11-02T10:30:00Z');
    const calendar = await createBookingStore(fixture.sql).calendar(
      member.id,
      professional.id,
      clock,
    );
    const starts = calendar.slots.map((slot) => slot.startsAt);
    // Opening hours are 09:00-17:00 UTC; 12:30 is the earliest allowed start.
    expect(starts[0]).toBe('2026-11-02T13:00:00Z');
    expect(starts).not.toContain('2026-11-02T12:00:00Z');
    expect(starts).not.toContain('2026-11-02T11:00:00Z');
  });

  it('applies the same notice when rescheduling and keeps the original session', async () => {
    const member = await user('member');
    const professional = await user('professional');
    clock = new Date('2026-11-01T00:00:00Z');
    const original = (
      await book(member.cookie, professional.id, '2026-11-04T09:00:00Z')
    ).json().booking;
    clock = nearBy(hour / 2);
    const rejected = await change(
      member.cookie,
      original.id,
      'reschedule',
      original.startsAt,
      '2026-11-02T10:00:00Z',
    );
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().message).toContain('2 hours');
    expect(
      await createBookingStore(fixture.sql).find(member.id, original.id),
    ).toEqual(original);
    const offered = await createBookingStore(fixture.sql).rescheduleSlots(
      member.id,
      original.id,
      clock,
    );
    expect(offered.slots.map((slot) => slot.startsAt)).not.toContain(
      '2026-11-02T10:00:00Z',
    );
    clock = nearBy(2 * hour);
    expect(
      (
        await change(
          member.cookie,
          original.id,
          'reschedule',
          original.startsAt,
          '2026-11-02T11:00:00Z',
        )
      ).statusCode,
    ).toBe(200);
  });

  it('keeps a replayed booking valid even after its notice window has passed', async () => {
    const member = await user('member');
    const professional = await user('professional');
    clock = nearBy(3 * hour);
    const requestId = randomUUID();
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/bookings',
        headers: { ...headers, cookie: member.cookie },
        payload: {
          professionalId: professional.id,
          startsAt: '2026-11-02T09:00:00Z',
          requestId,
        },
      });
    expect((await send()).statusCode).toBe(201);
    clock = nearBy(hour);
    const replay = await send();
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
  });

  it('never skips the one-hour reminder on a valid booking', async () => {
    const member = await user('member');
    const professional = await user('professional');
    clock = nearBy(2 * hour);
    await book(member.cookie, professional.id);
    const rows = (
      await fixture.database.query<{ offset_minutes: number }>(
        'SELECT offset_minutes FROM booking_reminders',
      )
    ).rows;
    expect(rows.map((row) => row.offset_minutes)).toEqual([60, 60]);
  });
});
