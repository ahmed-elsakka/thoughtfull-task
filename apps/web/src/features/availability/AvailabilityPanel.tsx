import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WEEKDAYS,
  validateWorkingDays,
  type WorkingDay,
  type User,
} from '@thoughtfull/shared';
import {
  getAvailability,
  getSlotPreview,
  saveAvailability,
} from '../../lib/availability';

export function AvailabilityPanel({ user }: { user: User }) {
  const cache = useQueryClient();
  const key = ['availability', user.id];
  const previewKey = ['availability-slots', user.id];
  const week = useQuery({ queryKey: key, queryFn: getAvailability });
  const preview = useQuery({
    queryKey: previewKey,
    queryFn: getSlotPreview,
    refetchInterval: 60_000,
  });
  const [draft, setDraft] = useState<WorkingDay[] | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: saveAvailability,
    onSuccess: async (result) => {
      cache.setQueryData(key, result);
      setDraft(null);
      setSaved(true);
      await cache.invalidateQueries({ queryKey: previewKey });
    },
  });
  const days = draft ?? week.data?.days;
  const timezone = week.data?.timezone ?? user.timezone;

  function changeDay(dayOfWeek: number, patch: Partial<WorkingDay>) {
    if (!days) return;

    setDraft(
      days.map((day) =>
        day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day,
      ),
    );
    setValidationError(null);
    setSaved(false);
    mutation.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!days) return;

    const error = validateWorkingDays(days);
    setValidationError(error);
    setSaved(false);

    if (!error) mutation.mutate(days);
  }

  const dateFormat = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const timeFormat = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const groups = new Map<string, NonNullable<typeof preview.data>['slots']>();

  for (const slot of preview.data?.slots ?? []) {
    const label = dateFormat.format(new Date(slot.startsAt));
    groups.set(label, [...(groups.get(label) ?? []), slot]);
  }

  return (
    <section
      className="auth-card mt-8 rounded-3xl p-6 sm:p-8"
      aria-labelledby="availability-title"
    >
      <h2 id="availability-title" className="text-2xl font-semibold text-ink">
        Weekly working hours
      </h2>
      <p className="mt-2 text-copy">
        Set the hours you work each week. All times use your timezone:{' '}
        <strong>{timezone}</strong>.
      </p>
      <p id="slot-rule" className="mt-2 text-sm text-muted">
        Sessions last 50 minutes and start every hour from your opening time.
        For example, 09:00-17:00 gives starts at 09:00 through 16:00, with a
        10-minute gap between sessions.
      </p>
      {week.isPending ? (
        <p role="status" className="mt-6">
          Loading working hours...
        </p>
      ) : week.isError ? (
        <div className="mt-6">
          <p role="alert">{week.error.message}</p>
          <button
            type="button"
            className="primary mt-3"
            onClick={() => week.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6" aria-describedby="slot-rule">
          <fieldset disabled={mutation.isPending} className="space-y-3">
            <legend className="sr-only">
              Weekly availability in {timezone}
            </legend>
            {days?.map((day) => {
              const label = WEEKDAYS[day.dayOfWeek - 1]!;
              const open = day.startTime !== null;

              return (
                <div
                  key={day.dayOfWeek}
                  className="rounded-xl border border-soft p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-ink">{label}</span>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={`${label} open`}
                        checked={open}
                        onChange={(event) =>
                          changeDay(
                            day.dayOfWeek,
                            event.target.checked
                              ? { startTime: '09:00', endTime: '17:00' }
                              : { startTime: null, endTime: null },
                          )
                        }
                      />
                      {open ? 'Open' : 'Closed'}
                    </label>
                  </div>
                  {open && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="field">
                        From
                        <input
                          aria-label={`${label} opening time`}
                          type="time"
                          step="60"
                          required
                          value={day.startTime ?? ''}
                          onChange={(event) =>
                            changeDay(day.dayOfWeek, {
                              startTime: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        To
                        <input
                          aria-label={`${label} closing time`}
                          type="time"
                          step="60"
                          required
                          value={day.endTime ?? ''}
                          onChange={(event) =>
                            changeDay(day.dayOfWeek, {
                              endTime: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
          <p className="mt-3 text-sm text-muted">
            One range per day, at least 50 minutes. Opening and closing must be
            on the same day.
          </p>
          {(validationError || mutation.error) && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            >
              {validationError ?? mutation.error?.message}
            </p>
          )}
          {saved && (
            <p role="status" className="mt-4 font-medium text-link">
              Working hours saved.
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              className="primary"
              disabled={mutation.isPending || draft === null}
            >
              {mutation.isPending ? 'Saving...' : 'Save working hours'}
            </button>
            {draft !== null && (
              <span className="text-sm text-muted">
                You have unsaved changes.
              </span>
            )}
          </div>
        </form>
      )}
      <div className="mt-8 border-t border-soft pt-6">
        <h3 className="text-xl font-semibold text-ink">
          Slot preview - next 4 weeks
        </h3>
        <p className="mt-2 text-sm text-muted">
          Based on saved hours, shown in {timezone}. Past slots and ambiguous or
          nonexistent daylight-saving times are excluded.
        </p>
        {draft !== null && (
          <p className="mt-2 text-sm text-link">
            Save your changes to update this preview.
          </p>
        )}
        {preview.isPending ? (
          <p role="status" className="mt-4">
            Loading slots...
          </p>
        ) : preview.isError ? (
          <div className="mt-4">
            <p role="alert">{preview.error.message}</p>
            <button
              type="button"
              className="primary mt-3"
              onClick={() => preview.refetch()}
            >
              Retry preview
            </button>
          </div>
        ) : groups.size === 0 ? (
          <p className="mt-4 text-copy">
            No upcoming slots. Open a day and save working hours to generate
            slots.
          </p>
        ) : (
          <div
            className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-2"
            role="region"
            aria-label="Generated slots"
            tabIndex={0}
          >
            {[...groups].map(([label, slots]) => (
              <details
                key={label}
                className="rounded-xl border border-soft p-3"
              >
                <summary className="cursor-pointer font-medium text-ink">
                  {label}{' '}
                  <span className="text-sm font-normal text-muted">
                    ({slots.length} slots)
                  </span>
                </summary>
                <ul className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  {slots.map((slot) => (
                    <li
                      key={slot.startsAt}
                      className="rounded-lg bg-soft/30 px-3 py-2"
                    >
                      <time dateTime={slot.startsAt}>
                        {timeFormat.format(new Date(slot.startsAt))}
                      </time>{' '}
                      -{' '}
                      <time dateTime={slot.endsAt}>
                        {timeFormat.format(new Date(slot.endsAt))}
                      </time>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
