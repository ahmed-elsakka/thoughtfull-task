import { test, expect } from '@playwright/test';

test('polls for notifications, marks them read, preserves them on refresh errors, and stops after logout', async ({
  page,
}) => {
  // Exercise browser polling deterministically; SQL delivery and ownership have integration tests.
  await page.clock.install({ time: new Date('2026-11-03T14:00:00Z') });
  let requests = 0;
  let delivered = false;
  let readAt: string | null = null;
  let fail = false;
  let loggedIn = true;
  const notification = {
    id: '6a1365d0-1553-4a91-98f4-f8f915141962',
    bookingId: '367960f2-b0fa-4d25-8e83-97f232be91ec',
    counterpartName: 'Fictional Professional',
    sessionStartsAt: '2026-11-04T14:00:00Z',
    offsetMinutes: 1440,
    scheduledAt: '2026-11-03T14:00:00Z',
    createdAt: '2026-11-03T14:00:00Z',
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path === '/api/auth/me')
      json = {
        user: loggedIn
          ? {
              id: '21976b8b-0072-413b-8632-f5f9d681f8e6',
              name: 'Fictional Member',
              email: 'member@example.test',
              role: 'member',
              timezone: 'America/New_York',
            }
          : null,
      };
    else if (path === '/api/auth/logout') {
      loggedIn = false;
      await route.fulfill({ status: 204 });

      return;
    } else if (path.endsWith('/read')) {
      readAt = '2026-11-03T14:01:00Z';
      json = { message: 'Notification marked as read.' };
    } else if (path === '/api/notifications') {
      requests++;
      if (fail) {
        await route.fulfill({
          status: 500,
          json: { message: 'Temporary notification error.' },
        });

        return;
      }
      json = {
        notifications: delivered ? [{ ...notification, readAt }] : [],
        unreadCount: delivered && !readAt ? 1 : 0,
        nextPage: null,
      };
    } else if (path === '/api/sessions')
      json = { sessions: [], nextPage: null };
    else if (path === '/api/professionals')
      json = { professionals: [], nextPage: null };
    else throw new Error(`Unexpected API request: ${path}`);

    await route.fulfill({ json });
  });
  await page.goto('/');
  const bell = page.getByRole('button', { name: /^Notifications/ });
  const panel = page.getByRole('region', {
    name: 'Notifications',
    exact: true,
  });
  // The panel is a drop-down: closed until the bell is pressed.
  await expect(bell).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('unread-bubble')).toHaveCount(0);
  await bell.click();
  await expect(panel).toContainText('No notifications yet.');
  delivered = true;
  await page.clock.runFor(15_000);
  await expect(panel).toContainText('1 unread');
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread');
  await expect(page.getByTestId('unread-bubble')).toHaveText('1');
  // Escape closes the panel and the bubble stays.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('unread-bubble')).toHaveText('1');
  await bell.click();
  await expect(panel).toContainText('Fictional Professional');
  await expect(panel).toContainText('Nov 4, 2026, 9:00 AM');
  fail = true;
  await page.clock.runFor(15_000);
  await expect(panel).toContainText('Temporary notification error.');
  await expect(panel).toContainText('Fictional Professional');
  fail = false;
  await panel.getByRole('button', { name: 'Retry notifications' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Mark as read' }).click();
  await expect(panel).toContainText('0 unread');
  await expect(panel.getByRole('button', { name: 'Mark as read' })).toHaveCount(
    0,
  );
  await expect(page.getByTestId('unread-bubble')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('unread-bubble')).toHaveCount(0);
  await bell.click();
  await expect(panel).toContainText('0 unread');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(bell).toHaveCount(0);
  const afterLogout = requests;
  await page.clock.runFor(30_000);
  expect(requests).toBe(afterLogout);
});
