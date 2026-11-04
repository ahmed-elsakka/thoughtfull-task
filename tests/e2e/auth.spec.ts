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

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();

    // Each account type opens on its own default view.
    const defaultView =
      role === 'member' ? 'Find a Professional' : 'My Sessions';
    await expect(nav.getByRole('link', { name: defaultView })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page.getByRole('heading', {
        name: role === 'member' ? 'Find a professional' : 'My sessions',
        level: 2,
      }),
    ).toBeVisible();

    // Navigation only offers the sections that belong to the account type.
    const professionalOnly = ['Availability', 'Blocked Dates'];

    for (const label of professionalOnly)
      await expect(nav.getByRole('link', { name: label })).toHaveCount(
        role === 'professional' ? 1 : 0,
      );

    await expect(
      nav.getByRole('link', { name: 'Find a Professional' }),
    ).toHaveCount(role === 'member' ? 1 : 0);

    await page.getByRole('button', { name: 'Account menu' }).click();
    const account = page.getByRole('region', { name: 'Account' });
    await expect(account).toContainText('Example User');
    await expect(
      account.getByText('Africa/Cairo', { exact: true }),
    ).toBeVisible();
    await page.reload();

    await expect(nav).toBeVisible();

    if (role === 'member') {
      await expect(
        page.getByRole('heading', { name: 'Weekly working hours' }),
      ).toHaveCount(0);
    }

    await page.getByRole('button', { name: 'Account menu' }).click();
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

    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });
}
