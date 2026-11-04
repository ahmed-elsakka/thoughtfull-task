import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('a member selects a date and time, confirms, and cannot book that slot again', async ({
  page,
  request,
}) => {
  const headers = {
    Origin: 'http://127.0.0.1:5174',
    'X-Requested-With': 'ThoughtFull',
  };
  const name = `Booking Professional ${randomUUID()}`;
  const signup = await request.post('http://127.0.0.1:3001/api/auth/signup', {
    headers,
    data: {
      name,
      email: `${randomUUID()}@example.test`,
      password: 'an example secure passphrase',
      role: 'professional',
      timezone: 'Asia/Singapore',
    },
  });
  expect(signup.status()).toBe(201);
  const professionalId = (await signup.json()).user.id;
  const hours = await request.put(
    'http://127.0.0.1:3001/api/professional/availability',
    {
      headers,
      data: {
        days: Array.from({ length: 7 }, (_, index) => ({
          dayOfWeek: index + 1,
          startTime: '09:00',
          endTime: '17:00',
        })),
      },
    },
  );
  expect(hours.status()).toBe(200);

  await page.goto('/');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.getByLabel('Full name').fill('Booking Member');
  await page
    .getByLabel('Email', { exact: true })
    .fill(`${randomUUID()}@example.test`);
  await page
    .getByLabel('Password', { exact: true })
    .fill('an example secure passphrase');
  await page.getByLabel('Account type').selectOption('member');
  await page.getByLabel('Timezone').selectOption('America/New_York');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await page.getByRole('link', { name: `View profile of ${name}` }).click();
  const calendar = page.getByRole('region', { name: 'Book a session' });
  await expect(calendar).toContainText('America/New_York');
  const first = calendar
    .getByRole('group', { name: 'Available times' })
    .getByRole('button')
    .first();
  await expect(first).toBeVisible();
  const time = await first.innerText();
  await first.click();
  await expect(
    page.getByRole('heading', { name: 'Confirm your session' }),
  ).toBeVisible();
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/bookings') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Confirm booking', exact: true })
    .click();
  const booked = await response;
  expect(booked.status()).toBe(201);
  const result = await booked.json();
  await expect(
    page.getByRole('heading', { name: 'Booking confirmed' }),
  ).toBeVisible();
  await expect(
    calendar
      .getByRole('group', { name: 'Available times' })
      .getByRole('button', { name: time, exact: true }),
  ).toHaveCount(0);
  const remaining = await page.request.get(
    `/api/professionals/${professionalId}/slots`,
  );
  expect(
    (await remaining.json()).slots.some(
      (slot: { startsAt: string }) =>
        Date.parse(slot.startsAt) === Date.parse(result.booking.startsAt),
    ),
  ).toBe(false);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My Sessions' })
    .click();
  const sessions = page.getByRole('region', { name: 'My sessions' });
  await expect(sessions).toContainText(name);
  await expect(sessions).toContainText('America/New_York');
  await sessions.getByRole('button', { name: 'Past', exact: true }).click();
  await expect(sessions).toContainText('No past sessions yet.');
  await sessions.getByRole('button', { name: 'Upcoming', exact: true }).click();
  await expect(sessions.getByRole('listitem')).toHaveCount(1);
  await page.reload();
  await expect(sessions).toContainText(name);

  // Create a session far enough ahead to exercise member changes.
  const future = (await remaining.json()).slots.find(
    (slot: { startsAt: string }) =>
      Date.parse(slot.startsAt) > Date.now() + 48 * 60 * 60 * 1000,
  );
  expect(future).toBeTruthy();
  const changeableResponse = await page.request.post('/api/bookings', {
    headers,
    data: {
      professionalId,
      startsAt: future.startsAt,
      requestId: randomUUID(),
    },
  });
  expect(changeableResponse.status()).toBe(201);
  const changeable = (await changeableResponse.json()).booking;
  await page.reload();
  let card = sessions
    .getByRole('listitem')
    .filter({ has: page.locator(`time[datetime="${changeable.startsAt}"]`) });
  await card.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const alternatives = await page.request.get(
    `/api/sessions/${changeable.id}/reschedule-slots`,
  );
  const replacement = (await alternatives.json()).slots.find(
    (slot: { startsAt: string }) =>
      Date.parse(slot.startsAt) > Date.now() + 48 * 60 * 60 * 1000,
  );
  const newDay = new Intl.DateTimeFormat('en', {
    timeZone: 'America/New_York',
    dateStyle: 'full',
  }).format(new Date(replacement.startsAt));
  await card.getByLabel('New date').selectOption(newDay);
  await card.getByLabel('New time').selectOption(replacement.startsAt);
  await card
    .getByRole('button', { name: 'Confirm reschedule', exact: true })
    .click();
  await expect(sessions).toContainText('Session rescheduled.');
  card = sessions.getByRole('listitem').filter({
    has: page.locator(
      `time[datetime="${new Date(replacement.startsAt).toISOString()}"]`,
    ),
  });
  await card
    .getByRole('button', { name: 'Cancel session', exact: true })
    .click();
  await card
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await expect(sessions).toContainText('Session cancelled.');
  await expect(card).toHaveCount(0);
});
