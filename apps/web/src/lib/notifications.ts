import type { NotificationPage } from '@thoughtfull/shared';

export async function getNotifications(
  page: number,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  const response = await fetch(`/api/notifications?page=${page}`, {
    credentials: 'same-origin',
    signal,
  });
  const data = await response.json();

  if (!response.ok)
    throw new Error(data.message ?? 'Unable to load notifications.');

  return data;
}

export async function markNotificationRead(id: string): Promise<void> {
  const response = await fetch(
    `/api/notifications/${encodeURIComponent(id)}/read`,
    {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'ThoughtFull',
      },
      body: '{}',
    },
  );

  if (!response.ok) {
    const data = await response.json();

    throw new Error(data.message ?? 'Unable to mark notification as read.');
  }
}
