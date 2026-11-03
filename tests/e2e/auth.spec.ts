import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

for (const role of ['member', 'professional']) {
  test(`${role} can sign up, stay signed in after reload, log out, and log in`, async ({
    page,
  }) => {
    const email = `${randomUUID()}@example.test`;
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await page.getByLabel('Full name').fill('Example User');
    await page.getByLabel('Email', { exact: true }).fill(email);

    await page
      .getByLabel('Password', { exact: true })
      .fill('an example secure passphrase');

    await page.getByLabel('Account type').selectOption(role);
    await page.getByLabel('Timezone').selectOption('Africa/Cairo');

    await page
      .getByRole('button', { name: 'Create account', exact: true })
      .click();

    await expect(
      page.getByRole('heading', { name: 'Hello, Example User' }),
    ).toBeVisible();

    await expect(page.getByText('Africa/Cairo', { exact: true })).toBeVisible();
    await page.reload();

    await expect(
      page.getByRole('heading', { name: 'Hello, Example User' }),
    ).toBeVisible();

    if (role === 'member') {
      await expect(
        page.getByRole('heading', { name: 'Weekly working hours' }),
      ).toHaveCount(0);
    }

    await page.getByRole('button', { name: 'Log out', exact: true }).click();

    await expect(
      page.getByRole('heading', { name: 'Welcome back' }),
    ).toBeVisible();

    await page.getByLabel('Email', { exact: true }).fill(email);

    await page
      .getByLabel('Password', { exact: true })
      .fill('incorrect password');

    await page.getByRole('button', { name: 'Log in', exact: true }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'Invalid email or password.',
    );

    await page
      .getByLabel('Password', { exact: true })
      .fill('an example secure passphrase');

    await page.getByRole('button', { name: 'Log in', exact: true }).click();

    await expect(
      page.getByRole('heading', { name: 'Hello, Example User' }),
    ).toBeVisible();
  });
}
