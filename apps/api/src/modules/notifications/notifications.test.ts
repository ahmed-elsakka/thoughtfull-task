import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  createAuthStore,
  createAvailabilityStore,
  createBookingStore,
  createNotificationStore,
  type SqlDatabase,
} from '@thoughtfull/db';
import { emptyWeek } from '@thoughtfull/shared';
import { createTestDatabase } from '../../../../../tests/support/database.js';
import { buildApp } from '../../app.js';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let now = new Date('2026-11-02T00:00:00Z');
const headers = {
  origin: 'http://127.0.0.1:5173',
  'x-requested-with': 'ThoughtFull',
};

function makeApp() {
  return buildApp({
    logger: false,
    auth: {
      store: createAuthStore(fixture.sql),
      origin: headers.origin,
      secureCookies: false,
      now: () => now,
    },
    notifications: createNotificationStore(fixture.sql),
  });
}

async function user(role: 'member' | 'professional') {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  await createAuthStore(fixture.sql).createUser(
    {
      id,
      role,
      name: `Fictional ${role}`,
      email: `${id}@example.test`,
      passwordHash: 'unused',
      timezone: 'America/New_York',
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
        startTime: '09:00',
        endTime: '17:00',
      })),
    );

  return { id, cookie: `thoughtfull_session=${token}` };
}

async function setup() {
  const member = await user('member');
  const professional = await user('professional');
  const bookings = createBookingStore(fixture.sql);
  const { booking } = await bookings.book(
    member.id,
    {
      professionalId: professional.id,
      requestId: randomUUID(),
      startsAt: '2026-11-04T14:00:00Z',
    },
    () => now,
  );

  return {
    member,
    professional,
    booking,
    bookings,
    notifications: createNotificationStore(fixture.sql),
  };
}

beforeAll(async () => {
  fixture = await createTestDatabase();
}, 30_000);

beforeEach(async () => {
  await fixture.database.exec(
    'TRUNCATE notifications, booking_reminders, bookings, professional_availability, professional_blocked_dates, auth_sessions, users',
  );
  now = new Date('2026-11-02T00:00:00Z');
  app = makeApp();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await fixture.database.close();
});

it('delivers each due reminder to both participants at the exact due instant, once', async () => {
  const { member, professional, booking, notifications } = await setup();
  expect(
    await notifications.deliverDue(new Date('2026-11-03T13:59:59.999Z')),
  ).toBe(0);
  expect(await notifications.deliverDue(new Date('2026-11-03T14:00:00Z'))).toBe(
    2,
  );
  expect(await notifications.deliverDue(new Date('2026-11-03T14:00:00Z'))).toBe(
    0,
  );
  expect(await notifications.deliverDue(new Date('2026-11-04T13:00:00Z'))).toBe(
    2,
  );
  expect(await notifications.deliverDue(new Date('2026-11-04T14:00:00Z'))).toBe(
    0,
  );
  const memberList = await notifications.list(member.id, 1);
  expect(memberList.unreadCount).toBe(2);
  expect(memberList.notifications.map((n) => n.offsetMinutes)).toEqual([
    60, 1440,
  ]);
  expect(memberList.notifications[0]).toMatchObject({
    bookingId: booking.id,
    counterpartName: 'Fictional professional',
    sessionStartsAt: booking.startsAt,
    readAt: null,
  });
  expect(
    (await notifications.list(professional.id, 1)).notifications[0]!
      .counterpartName,
  ).toBe('Fictional member');
});

it('catches up overdue reminders after a worker/API restart without duplicating them', async () => {
  const { member, notifications } = await setup();
  expect(await notifications.deliverDue(new Date('2026-11-03T14:00:00Z'))).toBe(
    2,
  );
  await app.close();
  app = makeApp();
  expect(
    await createNotificationStore(fixture.sql).deliverDue(
      new Date('2026-11-05T00:00:00Z'),
    ),
  ).toBe(2);
  expect(
    await createNotificationStore(fixture.sql).deliverDue(
      new Date('2026-11-05T00:00:00Z'),
    ),
  ).toBe(0);
  const response = await app.inject({
    url: '/api/notifications',
    headers: { cookie: member.cookie },
  });
  expect(response.json().notifications).toHaveLength(2);
});

it('rolls back notification creation if marking delivery fails, then retries successfully', async () => {
  const { notifications } = await setup();
  const broken: SqlDatabase = {
    query: fixture.sql.query,
    transaction: (run) =>
      fixture.sql.transaction((db) =>
        run({
          query: async (sql, values) => {
            if (sql.startsWith('UPDATE booking_reminders'))
              throw new Error('delivery update failed');

            return db.query(sql, values);
          },
        }),
      ),
  };
  const due = new Date('2026-11-03T14:00:00Z');
  await expect(createNotificationStore(broken).deliverDue(due)).rejects.toThrow(
    'delivery update failed',
  );
  expect(
    (await fixture.sql.query('SELECT * FROM notifications')).rows,
  ).toHaveLength(0);
  expect(
    (
      await fixture.sql.query(
        'SELECT * FROM booking_reminders WHERE delivered_at IS NOT NULL',
      )
    ).rows,
  ).toHaveLength(0);
  expect(await notifications.deliverDue(due)).toBe(2);
});

it('uses the unique reminder key as a final duplicate-delivery safeguard', async () => {
  const { notifications } = await setup();
  const due = new Date('2026-11-03T14:00:00Z');
  await notifications.deliverDue(due);
  await fixture.sql.query('UPDATE booking_reminders SET delivered_at = NULL');
  expect(await notifications.deliverDue(due)).toBe(0);
  expect(
    (await fixture.sql.query('SELECT * FROM notifications')).rows,
  ).toHaveLength(2);
  expect(
    (
      await fixture.sql.query(
        'SELECT * FROM booking_reminders WHERE delivered_at IS NOT NULL',
      )
    ).rows,
  ).toHaveLength(2);
});

it('cancellation removes pending delivery without removing delivered notification history', async () => {
  const { member, booking, bookings, notifications } = await setup();
  now = new Date('2026-11-03T14:00:00Z');
  await notifications.deliverDue(now);
  await bookings.cancel(
    member.id,
    'member',
    booking.id,
    { expectedStartsAt: booking.startsAt },
    () => now,
  );
  expect(await notifications.deliverDue(new Date('2026-11-05T00:00:00Z'))).toBe(
    0,
  );
  expect((await notifications.list(member.id, 1)).notifications).toHaveLength(
    1,
  );
});

it('does not deliver cancelled sessions, even if an obsolete pending reminder exists', async () => {
  const { booking, notifications } = await setup();
  await fixture.sql.query(
    "UPDATE bookings SET status = 'cancelled' WHERE id = $1",
    [booking.id],
  );
  expect(await notifications.deliverDue(new Date('2026-11-05T00:00:00Z'))).toBe(
    0,
  );
});

it('rescheduling keeps delivered history and delivers only the replacement pending reminders', async () => {
  const { member, booking, bookings, notifications } = await setup();
  now = new Date('2026-11-03T14:00:00Z');
  await notifications.deliverDue(now);
  await bookings.reschedule(
    member.id,
    booking.id,
    { expectedStartsAt: booking.startsAt, startsAt: '2026-11-06T14:00:00Z' },
    () => now,
  );
  expect(await notifications.deliverDue(new Date('2026-11-04T13:00:00Z'))).toBe(
    0,
  );
  expect(await notifications.deliverDue(new Date('2026-11-05T14:00:00Z'))).toBe(
    2,
  );
  const list = await notifications.list(member.id, 1);
  expect(list.notifications.map((n) => n.sessionStartsAt)).toEqual([
    '2026-11-06T14:00:00.000Z',
    booking.startsAt,
  ]);
});

it('enforces notification ownership, authentication, input validation and CSRF', async () => {
  const { member, professional, notifications } = await setup();
  const other = await user('member');
  await notifications.deliverDue(new Date('2026-11-03T14:00:00Z'));
  const id = (await notifications.list(member.id, 1)).notifications[0]!.id;
  expect((await app.inject({ url: '/api/notifications' })).statusCode).toBe(
    401,
  );
  for (const query of [
    'page=0',
    'page=1.5',
    'page=1000000',
    `userId=${member.id}`,
  ]) {
    expect(
      (
        await app.inject({
          url: `/api/notifications?${query}`,
          headers: { cookie: member.cookie },
        })
      ).statusCode,
    ).toBe(400);
  }
  for (const cookie of [other.cookie, professional.cookie]) {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/notifications/${id}/read`,
          headers: { ...headers, cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  }
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/notifications/${id}/read`,
        headers: { cookie: member.cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  const empty = await app.inject({
    url: '/api/notifications',
    headers: { cookie: other.cookie },
  });
  expect(empty.json()).toEqual({
    notifications: [],
    unreadCount: 0,
    nextPage: null,
  });
  const own = await app.inject({
    url: '/api/notifications',
    headers: { cookie: member.cookie },
  });
  expect(own.body).not.toContain('recipient');
  expect(own.body).not.toContain('sourceReminder');
  expect(own.body).not.toContain('email');
});

it('marks only owned notifications read idempotently and persists the unread count', async () => {
  const { member, notifications } = await setup();
  now = new Date('2026-11-03T14:00:00Z');
  await notifications.deliverDue(now);
  const id = (await notifications.list(member.id, 1)).notifications[0]!.id;
  const mark = () =>
    app.inject({
      method: 'PATCH',
      url: `/api/notifications/${id}/read`,
      headers: { ...headers, cookie: member.cookie },
      payload: {},
    });
  expect((await mark()).statusCode).toBe(200);
  const firstRead = now.toISOString();
  now = new Date('2026-11-03T14:05:00Z');
  expect((await mark()).statusCode).toBe(200);
  await app.close();
  app = makeApp();
  const list = (
    await app.inject({
      url: '/api/notifications',
      headers: { cookie: member.cookie },
    })
  ).json();
  expect(list.unreadCount).toBe(0);
  expect(list.notifications[0].readAt).toBe(firstRead);
});

it('paginates notifications newest first and counts unread records beyond the page', async () => {
  const { member, booking, notifications } = await setup();
  for (let index = 0; index < 22; index++) {
    await fixture.sql.query(
      'INSERT INTO notifications (id, source_reminder_id, booking_id, recipient_id, counterpart_name, session_starts_at, offset_minutes, scheduled_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,60,$7,$7)',
      [
        randomUUID(),
        randomUUID(),
        booking.id,
        member.id,
        'Fictional professional',
        booking.startsAt,
        new Date(now.getTime() + index * 1000),
      ],
    );
  }
  const first = await notifications.list(member.id, 1);
  const second = await notifications.list(member.id, 2);
  expect(first.notifications).toHaveLength(20);
  expect(first.nextPage).toBe(2);
  expect(first.unreadCount).toBe(22);
  expect(second.notifications).toHaveLength(2);
  expect(second.nextPage).toBeNull();
  expect(
    new Set([...first.notifications, ...second.notifications].map((n) => n.id))
      .size,
  ).toBe(22);
  expect(Date.parse(first.notifications[0]!.createdAt)).toBeGreaterThan(
    Date.parse(second.notifications[0]!.createdAt),
  );
});

it('drains a backlog larger than one pass, delivering every reminder once', async () => {
  const member = await user('member');
  const professional = await user('professional');
  const first = new Date('2026-11-10T09:00:00Z').getTime();

  for (let index = 0; index < 60; index++) {
    const bookingId = randomUUID();
    const startsAt = new Date(first + index * 2 * 3_600_000);
    await fixture.sql.query(
      'INSERT INTO bookings (id, member_id, professional_id, request_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        bookingId,
        member.id,
        professional.id,
        randomUUID(),
        startsAt,
        new Date(startsAt.getTime() + 50 * 60_000),
      ],
    );

    for (const recipientId of [member.id, professional.id])
      await fixture.sql.query(
        'INSERT INTO booking_reminders (id, booking_id, recipient_id, offset_minutes, scheduled_at) VALUES ($1, $2, $3, 60, $4)',
        [
          randomUUID(),
          bookingId,
          recipientId,
          new Date(startsAt.getTime() - 3_600_000),
        ],
      );
  }

  const store = createNotificationStore(fixture.sql);
  const due = new Date('2026-12-01T00:00:00Z');
  // Each pass handles at most 50 bookings, two recipients each.
  expect(await store.deliverDue(due)).toBe(100);
  expect(await store.deliverDue(due)).toBe(20);
  expect(await store.deliverDue(due)).toBe(0);
  expect(
    (await fixture.sql.query('SELECT * FROM notifications')).rows,
  ).toHaveLength(120);
  expect(
    (
      await fixture.sql.query(
        'SELECT * FROM booking_reminders WHERE delivered_at IS NULL',
      )
    ).rows,
  ).toHaveLength(0);
});

it('lets a professional cancel inside 24 hours and removes pending reminders for both people', async () => {
  const { member, professional, booking, bookings, notifications } =
    await setup();
  now = new Date('2026-11-04T10:00:00Z');
  await bookings.cancel(
    professional.id,
    'professional',
    booking.id,
    { expectedStartsAt: booking.startsAt },
    () => now,
  );
  expect(
    (await fixture.sql.query('SELECT * FROM booking_reminders')).rows,
  ).toHaveLength(0);
  expect(await notifications.deliverDue(new Date('2026-11-05T00:00:00Z'))).toBe(
    0,
  );
  expect((await notifications.list(member.id, 1)).notifications).toHaveLength(
    0,
  );
});
