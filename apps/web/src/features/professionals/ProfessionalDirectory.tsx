import { BookingCalendar } from '../booking/BookingCalendar';
import { useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SESSION_DURATION_MINUTES } from '@thoughtfull/shared';
import { getProfessional, getProfessionals } from '../../lib/professionals';

function subscribeToLocation(callback: () => void) {
  window.addEventListener('hashchange', callback);

  return () => window.removeEventListener('hashchange', callback);
}

function currentProfileId() {
  const prefix = '#professionals/';

  return window.location.hash.startsWith(prefix)
    ? window.location.hash.slice(prefix.length)
    : '';
}

function Profile({ id, memberId }: { id: string; memberId: string }) {
  const profile = useQuery({
    queryKey: ['professionals', memberId, 'profile', id],
    queryFn: () => getProfessional(id),
    retry: false,
  });

  return (
    <>
      <a
        href="#professionals"
        className="font-semibold text-link underline underline-offset-4"
      >
        Back to professionals
      </a>
      {profile.isPending ? (
        <p role="status" className="mt-5">
          Loading profile...
        </p>
      ) : profile.isError ? (
        <div className="mt-5">
          <h2 className="text-2xl font-semibold text-ink">
            Profile unavailable
          </h2>
          <p role="alert" className="mt-3">
            {profile.error.message}
          </p>
          <button className="primary mt-4" onClick={() => profile.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <article className="mt-6">
          <p className="text-sm font-medium text-link">Professional</p>
          <h2 className="mt-2 break-words text-3xl font-semibold text-ink">
            {profile.data.professional.name}
          </h2>
          <dl className="mt-6 space-y-4">
            <div>
              <dt className="text-sm text-muted">Timezone</dt>
              <dd className="mt-1 break-words font-medium">
                {profile.data.professional.timezone}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Session duration</dt>
              <dd className="mt-1 font-medium">
                {SESSION_DURATION_MINUTES} minutes
              </dd>
            </div>
          </dl>
          <BookingCalendar
            key={id}
            professional={profile.data.professional}
            memberId={memberId}
          />
        </article>
      )}
    </>
  );
}

export function ProfessionalDirectory({ memberId }: { memberId: string }) {
  const id = useSyncExternalStore(
    subscribeToLocation,
    currentProfileId,
    () => '',
  );
  const [page, setPage] = useState(1);
  const directory = useQuery({
    queryKey: ['professionals', memberId, 'list', page],
    queryFn: () => getProfessionals(page),
    enabled: !id,
    retry: false,
  });

  return (
    <section
      className="auth-card mt-8 rounded-3xl p-6 sm:p-8"
      aria-label="Professional directory"
    >
      {id ? (
        <Profile key={id} id={id} memberId={memberId} />
      ) : (
        <>
          <h2 className="text-2xl font-semibold text-ink">
            Find a professional
          </h2>
          <p className="mt-2 text-copy">
            Explore professionals and open a profile to learn more.
          </p>
          {directory.isPending ? (
            <p role="status" className="mt-5">
              Loading professionals...
            </p>
          ) : directory.isError ? (
            <div className="mt-5">
              <p role="alert">{directory.error.message}</p>
              <button
                className="primary mt-4"
                onClick={() => directory.refetch()}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              {directory.data.professionals.length === 0 ? (
                <p className="mt-6 rounded-xl bg-soft/30 p-4">
                  {page === 1
                    ? 'No professionals have joined yet. Please check back later.'
                    : 'No professionals on this page. Go back to the previous page.'}
                </p>
              ) : (
                <ul className="mt-6 space-y-4">
                  {directory.data.professionals.map((professional) => (
                    <li
                      key={professional.id}
                      className="rounded-xl border border-soft p-5"
                    >
                      <h3 className="break-words text-lg font-semibold text-ink">
                        {professional.name}
                      </h3>
                      <p className="mt-1 break-words text-sm text-muted">
                        Timezone: {professional.timezone}
                      </p>
                      <a
                        href={`#professionals/${professional.id}`}
                        aria-label={`View profile of ${professional.name}`}
                        className="mt-4 inline-block font-semibold text-link underline underline-offset-4"
                      >
                        View profile
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {(page > 1 || directory.data.nextPage !== null) && (
                <nav
                  className="mt-6 flex items-center justify-between gap-3"
                  aria-label="Professional pages"
                >
                  <button
                    className="primary"
                    disabled={page === 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous
                  </button>
                  <span aria-live="polite" className="text-sm text-muted">
                    Page {page}
                  </span>
                  <button
                    className="primary"
                    disabled={directory.data.nextPage === null}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
