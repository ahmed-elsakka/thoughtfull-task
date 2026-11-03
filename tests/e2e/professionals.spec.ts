import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('a member opens a profile, refreshes it, and returns to the directory', async ({
  page,
  request,
}) => {
  const name = `Example Professional ${randomUUID()}`;
  const created = await request.post('http://127.0.0.1:3001/api/auth/signup', {
    headers: {
      Origin: 'http://127.0.0.1:5174',
      'X-Requested-With': 'ThoughtFull',
    },
    data: {
      name,
      email: `${randomUUID()}@example.test`,
      password: 'an example secure passphrase',
      role: 'professional',
      timezone: 'Asia/Singapore',
    },
  });
  expect(created.status()).toBe(201);

  await page.goto('/');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.getByLabel('Full name').fill('Example Member');
  await page
    .getByLabel('Email', { exact: true })
    .fill(`${randomUUID()}@example.test`);
  await page
    .getByLabel('Password', { exact: true })
    .fill('an example secure passphrase');
  await page.getByLabel('Account type').selectOption('member');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Find a professional' }),
  ).toBeVisible();
  await page.getByRole('link', { name: `View profile of ${name}` }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('50 minutes', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to professionals' }).click();
  await expect(
    page.getByRole('heading', { name: 'Find a professional' }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
});
