import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@thoughtfull/shared';
import {
  getNotifications,
  markNotificationRead,
} from '../../lib/notifications';

export function Notifications({ user }: { user: User }) {
  const [page, setPage] = useState(1);
  const cache = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications', user.id, page],
    queryFn: ({ signal }) => getNotifications(page, signal),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['notifications', user.id] });
    },
  });
  const dateTime = new Intl.DateTimeFormat('en', {
    timeZone: user.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <section
      className="auth-card mt-8 rounded-3xl p-6 sm:p-8"
      aria-labelledby="notifications-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="notifications-title"
          className="text-2xl font-semibold text-ink"
        >
          Notifications
        </h2>
        {notifications.data && (
          <span
            className="rounded-full bg-mint px-3 py-1 text-sm font-semibold text-ink"
            aria-live="polite"
          >
            {notifications.data.unreadCount} unread
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted">
        Session reminders appear here. Times shown in {user.timezone}.
      </p>
      {notifications.isPending ? (
        <p role="status" className="mt-4">
          Loading notifications...
        </p>
      ) : (
        <>
          {notifications.isError && (
            <div className="mt-4">
              <p role="alert">{notifications.error.message}</p>
              <button
                className="secondary mt-2"
                onClick={() => notifications.refetch()}
              >
                Retry notifications
              </button>
            </div>
          )}
          {markRead.error && (
            <p role="alert" className="mt-4 text-red-800">
              {markRead.error.message}
            </p>
          )}
          {notifications.data && (
            <>
              {notifications.data.notifications.length === 0 ? (
                <p className="mt-5">
                  {page === 1
                    ? 'No notifications yet.'
                    : 'No more notifications on this page.'}
                </p>
              ) : (
                <ul className="mt-5 space-y-4" aria-label="Session reminders">
                  {notifications.data.notifications.map((notification) => (
                    <li
                      key={notification.id}
                      className={`rounded-2xl border p-4 ${notification.readAt ? 'border-soft' : 'border-brand bg-mint/10'}`}
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <h3 className="font-semibold text-ink">
                          {notification.offsetMinutes === 1440
                            ? '24-hour'
                            : '1-hour'}{' '}
                          session reminder
                        </h3>
                        {!notification.readAt && (
                          <span className="text-sm font-semibold text-link">
                            Unread
                          </span>
                        )}
                      </div>
                      <p className="mt-2 break-words">
                        Session with {notification.counterpartName}, scheduled
                        for{' '}
                        <time dateTime={notification.sessionStartsAt}>
                          {dateTime.format(
                            new Date(notification.sessionStartsAt),
                          )}
                        </time>
                        .
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        Received{' '}
                        <time dateTime={notification.createdAt}>
                          {dateTime.format(new Date(notification.createdAt))}
                        </time>
                        .
                      </p>
                      {!notification.readAt && (
                        <button
                          className="secondary mt-3"
                          disabled={markRead.isPending}
                          onClick={() => markRead.mutate(notification.id)}
                        >
                          {markRead.isPending &&
                          markRead.variables === notification.id
                            ? 'Saving...'
                            : 'Mark as read'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs text-muted">
                Reminders reflect the session time when sent. Check My sessions
                for any later changes.
              </p>
              <div
                className="mt-5 flex items-center gap-3"
                aria-label="Notification pages"
              >
                <button
                  className="secondary"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span className="text-sm text-muted">Page {page}</span>
                <button
                  className="secondary"
                  disabled={notifications.data.nextPage === null}
                  onClick={() => setPage(notifications.data.nextPage!)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
