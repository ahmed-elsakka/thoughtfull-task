import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MEMBER_CHANGE_NOTICE_MS,
  type SessionSummary,
  type User,
} from '@thoughtfull/shared';
import { changeSession, getRescheduleSlots } from '../../lib/bookings';

export function SessionActions({
  session,
  user,
  now,
  onChanged,
}: {
  session: SessionSummary;
  user: User;
  now: number;
  onChanged: (message: string) => void;
}) {
  const cache = useQueryClient();
  const [action, setAction] = useState<{
    kind: 'cancel' | 'reschedule';
    expectedStartsAt: string;
  } | null>(null);
  const [day, setDay] = useState('');
  const [selected, setSelected] = useState('');
  const slots = useQuery({
    queryKey: ['reschedule-slots', user.id, session.id],
    queryFn: () => getRescheduleSlots(session.id),
    enabled: action?.kind === 'reschedule',
    refetchInterval: 30_000,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: () =>
      changeSession(session.id, action!.kind, {
        expectedStartsAt: action!.expectedStartsAt,
        ...(action!.kind === 'reschedule' ? { startsAt: selected } : {}),
      }),
    onSuccess: async (result) => {
      setAction(null);
      onChanged(result.message);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['my-sessions', user.id] }),
        cache.invalidateQueries({ queryKey: ['booking-calendar'] }),
        cache.invalidateQueries({ queryKey: ['availability-slots'] }),
        cache.invalidateQueries({ queryKey: ['reschedule-slots'] }),
      ]);
    },
    onError: () => {
      void cache.invalidateQueries({
        queryKey: ['reschedule-slots', user.id, session.id],
      });
      void cache.invalidateQueries({ queryKey: ['my-sessions', user.id] });
    },
  });
  const format = new Intl.DateTimeFormat('en', {
    timeZone: user.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const dateFormat = new Intl.DateTimeFormat('en', {
    timeZone: user.timezone,
    dateStyle: 'full',
  });
  const timeFormat = new Intl.DateTimeFormat('en', {
    timeZone: user.timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
  });
  const available = slots.data?.slots ?? [];
  const days = [
    ...new Set(
      available.map((slot) => dateFormat.format(new Date(slot.startsAt))),
    ),
  ];
  const selectedDay = days.includes(day) ? day : (days[0] ?? '');
  const canChange =
    user.role === 'professional' ||
    Date.parse(session.startsAt) - now >= MEMBER_CHANGE_NOTICE_MS;

  function open(kind: 'cancel' | 'reschedule') {
    mutation.reset();
    setSelected('');
    setDay('');
    setAction({ kind, expectedStartsAt: session.startsAt });
  }

  if (session.status !== 'confirmed') return null;

  return (
    <div className="mt-4">
      {!canChange && (
        <p className="text-sm text-muted">
          Members cannot cancel or reschedule within 24 hours of the session
          start.
        </p>
      )}
      {!action ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            className="secondary"
            disabled={!canChange || mutation.isPending}
            onClick={() => open('cancel')}
          >
            Cancel session
          </button>
          {user.role === 'member' && (
            <button
              className="secondary"
              disabled={!canChange || mutation.isPending}
              onClick={() => open('reschedule')}
            >
              Reschedule
            </button>
          )}
        </div>
      ) : (
        <div
          className="mt-3 rounded-2xl bg-soft/20 p-4"
          role="group"
          aria-label={
            action.kind === 'cancel'
              ? 'Confirm cancellation'
              : 'Reschedule session'
          }
        >
          <h4 className="font-semibold text-ink">
            {action.kind === 'cancel'
              ? 'Cancel this session?'
              : 'Choose a new session time'}
          </h4>
          <p className="mt-2 text-sm">
            Current session: {format.format(new Date(action.expectedStartsAt))}{' '}
            ({user.timezone})
          </p>
          {action.kind === 'reschedule' && (
            <>
              <p className="mt-2 text-sm">
                Your original session stays booked until the new time is
                confirmed. The professional stays the same.
              </p>
              {slots.isPending ? (
                <p role="status">Loading available times...</p>
              ) : slots.isError ? (
                <div>
                  <p role="alert">{slots.error.message}</p>
                  <button
                    className="secondary mt-2"
                    onClick={() => slots.refetch()}
                  >
                    Retry available times
                  </button>
                </div>
              ) : available.length === 0 ? (
                <p role="status" className="mt-3">
                  No alternative times are available in the next four weeks.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  <label className="field">
                    New date
                    <select
                      value={selectedDay}
                      disabled={mutation.isPending}
                      onChange={(event) => {
                        setDay(event.target.value);
                        setSelected('');
                      }}
                    >
                      {days.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    New time
                    <select
                      value={selected}
                      disabled={mutation.isPending}
                      onChange={(event) => {
                        setDay(selectedDay);
                        setSelected(event.target.value);
                      }}
                    >
                      <option value="">Choose a time</option>
                      {available
                        .filter(
                          (slot) =>
                            dateFormat.format(new Date(slot.startsAt)) ===
                            selectedDay,
                        )
                        .map((slot) => (
                          <option key={slot.startsAt} value={slot.startsAt}>
                            {timeFormat.format(new Date(slot.startsAt))}
                          </option>
                        ))}
                    </select>
                  </label>
                  {selected && (
                    <p className="text-sm">
                      New session: {format.format(new Date(selected))} (
                      {user.timezone}), 50 minutes.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {mutation.error && (
            <p role="alert" className="mt-3 text-red-800">
              {mutation.error.message}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="primary"
              disabled={
                mutation.isPending ||
                !canChange ||
                (action.kind === 'reschedule' &&
                  (slots.isError ||
                    !available.some((slot) => slot.startsAt === selected)))
              }
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? 'Saving...'
                : action.kind === 'cancel'
                  ? 'Confirm cancellation'
                  : 'Confirm reschedule'}
            </button>
            <button
              className="secondary"
              disabled={mutation.isPending}
              onClick={() => setAction(null)}
            >
              Keep current session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
