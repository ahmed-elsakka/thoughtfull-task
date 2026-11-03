import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('a professional saves hours, previews generated slots, and closes a day', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.getByLabel('Full name').fill('Example Professional');
  await page
    .getByLabel('Email', { exact: true })
    .fill(`${randomUUID()}@example.test`);
  await page
    .getByLabel('Password', { exact: true })
    .fill('an example secure passphrase');
  await page.getByLabel('Account type').selectOption('professional');
  await page.getByLabel('Timezone').selectOption('Asia/Singapore');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();

  await expect(
    page.getByRole('heading', { name: 'Weekly working hours' }),
  ).toBeVisible();
  await expect(page.getByLabel('Monday open')).not.toBeChecked();
  await page.getByLabel('Monday open').check();
  await page.getByLabel('Monday opening time').fill('09:15');
  await page.getByLabel('Monday closing time').fill('09:30');
  await page.getByRole('button', { name: 'Save working hours' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 50 minutes');

  await page.getByLabel('Monday closing time').fill('11:05');
  await page.getByRole('button', { name: 'Save working hours' }).click();
  await expect(
    page.getByText('Working hours saved.', { exact: true }),
  ).toBeVisible();
  const slots = page.getByRole('region', { name: 'Generated slots' });
  await expect(slots).toBeVisible();
  // A future Monday always has both slots, even if today's starts have passed.
  await slots.locator('summary').last().click();
  await expect(slots.locator('details').last()).toContainText('09:15');
  await expect(slots.locator('details').last()).toContainText('11:05');
  await page.reload();
  await expect(page.getByLabel('Monday opening time')).toHaveValue('09:15');
  await expect(page.getByLabel('Monday closing time')).toHaveValue('11:05');

  await page.getByLabel('Monday open').uncheck();
  await page.getByRole('button', { name: 'Save working hours' }).click();
  await expect(
    page.getByText('Working hours saved.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('No upcoming slots.', { exact: false }),
  ).toBeVisible();
});
