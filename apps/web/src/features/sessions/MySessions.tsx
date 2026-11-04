import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SessionPeriod, User } from '@thoughtfull/shared';
import { getMySessions } from '../../lib/bookings';
import { SessionActions } from './SessionActions';

export function MySessions({ user }: { user: User }) {
  const [period, setPeriod] = useState<SessionPeriod>('upcoming');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState('');
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, []);

  const sessions = useQuery({
    queryKey: ['my-sessions', user.id, period, page],
    queryFn: () => getMySessions(period, page),
    refetchInterval: 30_000,
    retry: false,
  });
  const dateTime = new Intl.DateTimeFormat('en', {
    timeZone: user.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <section
      className="auth-card mt-8 rounded-3xl p-6 sm:p-8"
      aria-labelledby="my-sessions-title"
    >
      <h2 id="my-sessions-title" className="text-2xl font-semibold text-ink">
        My sessions
      </h2>
      <p className="mt-2 text-sm text-muted">
        Times shown in {user.timezone}. Sessions last 50 minutes.
      </p>
      {feedback && (
        <p role="status" className="mt-3 text-link">
          {feedback}
        </p>
      )}
      {user.role === 'member' ? (
        <div
          className="my-5 flex gap-3"
          role="group"
          aria-label="Session period"
        >
          {(['upcoming', 'past'] as const).map((value) => (
            <button
              key={value}
              className={period === value ? 'primary' : 'secondary'}
              aria-pressed={period === value}
              onClick={() => {
                setPeriod(value);
                setPage(1);
              }}
            >
              {value === 'upcoming' ? 'Upcoming' : 'Past'}
            </button>
          ))}
        </div>
      ) : (
        <h3 className="my-5 font-semibold">Upcoming schedule</h3>
      )}
      {period === 'upcoming' && (
        <p className="mb-4 text-sm text-muted">
          Includes sessions currently in progress.
        </p>
      )}
      {sessions.isPending ? (
        <p role="status">Loading sessions...</p>
      ) : sessions.isError ? (
        <div>
          <p role="alert">{sessions.error.message}</p>
          <button className="secondary mt-3" onClick={() => sessions.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {sessions.data.sessions.length === 0 ? (
            <p role="status">
              {page === 1
                ? `No ${period} sessions yet.`
                : 'No more sessions on this page.'}
            </p>
          ) : (
            <ul
              className="space-y-4"
              aria-label={`${period === 'upcoming' ? 'Upcoming' : 'Past'} sessions`}
            >
              {sessions.data.sessions.map((session) => (
                <li
                  key={session.id}
                  className="rounded-2xl border border-ink/10 p-4"
                >
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {user.role === 'member' ? 'Professional' : 'Member'}
                  </p>
                  <h3 className="mt-1 font-semibold text-ink break-words">
                    {session.counterpartName}
                  </h3>
                  <p className="mt-2 text-copy">
                    <time dateTime={session.startsAt}>
                      {dateTime.format(new Date(session.startsAt))}
                    </time>
                  </p>
                  <p className="text-sm text-muted">
                    Until{' '}
                    <time dateTime={session.endsAt}>
                      {dateTime.format(new Date(session.endsAt))}
                    </time>
                  </p>
                  <p className="mt-2 text-sm capitalize">{session.status}</p>
                  <SessionActions
                    session={session}
                    user={user}
                    now={now}
                    onChanged={setFeedback}
                  />
                </li>
              ))}
            </ul>
          )}
          <div
            className="mt-5 flex items-center gap-3"
            aria-label="Session pages"
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
              disabled={sessions.data.nextPage === null}
              onClick={() => setPage(sessions.data.nextPage!)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
