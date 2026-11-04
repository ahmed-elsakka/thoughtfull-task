import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BLOCKED_DATE_HORIZON_DAYS,
  todayInTimezone,
  validateBlockedDate,
  type User,
} from '@thoughtfull/shared';
import {
  blockDate,
  getBlockedDates,
  unblockDate,
} from '../../lib/availability';

export function BlockedDatesPanel({ user }: { user: User }) {
  const cache = useQueryClient();
  const key = ['blocked-dates', user.id];
  const dates = useQuery({ queryKey: key, queryFn: getBlockedDates });
  const timezone = dates.data?.timezone ?? user.timezone;
  const [date, setDate] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const today = todayInTimezone(new Date(), timezone);
  const update = {
    onSuccess: async (result: Awaited<ReturnType<typeof getBlockedDates>>) => {
      cache.setQueryData(key, result);
      // Slot previews change as soon as a date is blocked or restored.
      await cache.invalidateQueries({
        queryKey: ['availability-slots', user.id],
      });
    },
  };
  const block = useMutation({
    mutationFn: blockDate,
    ...update,
    onSuccess: async (result) => {
      await update.onSuccess(result);
      setDate('');
    },
  });
  const unblock = useMutation({ mutationFn: unblockDate, ...update });
  const label = new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateBlockedDate(date, today);
    setValidationError(error);
    unblock.reset();

    if (!error) block.mutate(date);
  }

  return (
    <section
      className="auth-card mt-8 rounded-3xl p-6 sm:p-8"
      aria-labelledby="blocked-dates-title"
    >
      <h2 id="blocked-dates-title" className="text-2xl font-semibold text-ink">
        Blocked dates
      </h2>
      <p className="mt-2 text-copy">
        Block off days you cannot work, such as holidays. Members will not see
        any slots on these dates. Dates use your timezone:{' '}
        <strong>{timezone}</strong>.
      </p>
      <p className="mt-2 text-sm text-muted">
        Blocking a date does not cancel sessions that are already booked. You
        can cancel those from My sessions.
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-wrap items-end gap-3">
        <label className="field">
          Date to block
          <input
            type="date"
            required
            min={today}
            value={date}
            disabled={block.isPending}
            onChange={(event) => {
              setDate(event.target.value);
              setValidationError(null);
              block.reset();
            }}
          />
        </label>
        <button className="primary" disabled={block.isPending}>
          {block.isPending ? 'Blocking...' : 'Block date'}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">
        Today or a date within the next {BLOCKED_DATE_HORIZON_DAYS} days.
      </p>
      {(validationError || block.error || unblock.error) && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {validationError ?? block.error?.message ?? unblock.error?.message}
        </p>
      )}
      {dates.isPending ? (
        <p role="status" className="mt-4">
          Loading blocked dates...
        </p>
      ) : dates.isError ? (
        <div className="mt-4">
          <p role="alert">{dates.error.message}</p>
          <button
            type="button"
            className="primary mt-3"
            onClick={() => dates.refetch()}
          >
            Try again
          </button>
        </div>
      ) : dates.data.dates.length === 0 ? (
        <p className="mt-4 text-copy">No upcoming blocked dates.</p>
      ) : (
        <ul className="mt-4 space-y-3" aria-label="Blocked dates">
          {dates.data.dates.map((entry) => (
            <li
              key={entry.date}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-soft p-4"
            >
              <div>
                <time dateTime={entry.date} className="font-semibold text-ink">
                  {label.format(new Date(`${entry.date}T00:00:00Z`))}
                </time>
                {entry.confirmedSessions > 0 && (
                  <p className="mt-1 text-sm text-red-800">
                    {entry.confirmedSessions === 1
                      ? '1 confirmed session is still booked on this date.'
                      : `${entry.confirmedSessions} confirmed sessions are still booked on this date.`}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="secondary"
                disabled={unblock.isPending}
                aria-label={`Unblock ${entry.date}`}
                onClick={() => unblock.mutate(entry.date)}
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
