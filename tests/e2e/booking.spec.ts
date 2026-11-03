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
});
