import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('a professional blocks a date, sees it listed, and unblocks it', async ({
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

  const panel = page.getByRole('region', { name: 'Blocked dates' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('No upcoming blocked dates.');

  // Ten days ahead is in the future in every timezone the test can pick.
  const target = new Date(Date.now() + 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await panel.getByLabel('Date to block').fill(target);
  await panel.getByRole('button', { name: 'Block date' }).click();
  const list = panel.getByRole('list', { name: 'Blocked dates' });
  await expect(list.locator(`time[datetime="${target}"]`)).toBeVisible();

  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Blocked dates' })
      .locator(`time[datetime="${target}"]`),
  ).toBeVisible();

  await page.getByRole('button', { name: `Unblock ${target}` }).click();
  await expect(
    page
      .getByRole('region', { name: 'Blocked dates' })
      .getByText('No upcoming blocked dates.'),
  ).toBeVisible();
});
