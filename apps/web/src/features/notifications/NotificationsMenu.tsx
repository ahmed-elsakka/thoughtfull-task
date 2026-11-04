import { useCallback, useEffect, useRef, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { User } from '@thoughtfull/shared';
import {
  getNotifications,
  markNotificationRead,
} from '../../lib/notifications';
import { BellIcon } from '../shell/icons';
import { useDismiss } from '../shell/useDismiss';

export function NotificationsMenu({
  user,
  open,
  onToggle,
  onClose,
}: {
  user: User;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const cache = useQueryClient();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDismiss(container, trigger, open, close);

  useEffect(() => {
    if (!open) setPage(1);
  }, [open]);

  // Always active, so the bubble stays current while the list is closed.
  const notifications = useQuery({
    queryKey: ['notifications', user.id, page],
    queryFn: ({ signal }) => getNotifications(page, signal),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: keepPreviousData,
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
  const unread = notifications.data?.unreadCount ?? 0;

  return (
    <div ref={container} className="sm:relative">
      <button
        ref={trigger}
        type="button"
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
        }
        aria-expanded={open}
        aria-controls="notifications-panel"
        onClick={onToggle}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-soft bg-white text-ink hover:bg-[#f0f7f9]"
      >
        <BellIcon />
        {unread > 0 && (
          <span
            aria-hidden="true"
            data-testid="unread-bubble"
            className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-xs font-bold leading-none text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          id="notifications-panel"
          aria-labelledby="notifications-title"
          className="auth-card absolute inset-x-4 top-full z-30 mt-2 max-h-[min(34rem,75vh)] overflow-y-auto rounded-2xl p-5 sm:inset-x-auto sm:right-0 sm:w-[26rem]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="notifications-title"
              className="text-xl font-semibold text-ink"
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
                    <ul
                      className="mt-5 space-y-3"
                      aria-label="Session reminders"
                    >
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
                            Session with {notification.counterpartName},
                            scheduled for{' '}
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
                              {dateTime.format(
                                new Date(notification.createdAt),
                              )}
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
                    Reminders reflect the session time when sent. Check My
                    Sessions for any later changes.
                  </p>
                  <div
                    className="mt-4 flex items-center gap-3"
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
      )}
    </div>
  );
}
