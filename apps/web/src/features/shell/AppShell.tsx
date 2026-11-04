import { useSyncExternalStore } from 'react';
import type { User } from '@thoughtfull/shared';
import { AvailabilityPanel } from '../availability/AvailabilityPanel';
import { BlockedDatesPanel } from '../availability/BlockedDatesPanel';
import { ProfessionalDirectory } from '../professionals/ProfessionalDirectory';
import { MySessions } from '../sessions/MySessions';
import { AppHeader } from './AppHeader';
import { viewFromHash } from './views';

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);

  return () => window.removeEventListener('hashchange', callback);
}

export function AppShell({
  user,
  onLogout,
  loggingOut,
  logoutError,
}: {
  user: User;
  onLogout: () => void;
  loggingOut: boolean;
  logoutError: string | null;
}) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  // An address that does not belong to this account type opens its default view.
  const current = viewFromHash(user.role, hash);

  return (
    <>
      <AppHeader
        user={user}
        view={current.view}
        onLogout={onLogout}
        loggingOut={loggingOut}
        logoutError={logoutError}
      />
      <h1 className="sr-only">{current.title}</h1>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6 [&>section:first-of-type]:mt-0">
        {current.view === 'find' && (
          <ProfessionalDirectory key={user.id} memberId={user.id} />
        )}
        {current.view === 'sessions' && (
          <MySessions key={`sessions-${user.id}`} user={user} />
        )}
        {current.view === 'availability' && (
          <AvailabilityPanel key={user.id} user={user} />
        )}
        {current.view === 'blocked' && (
          <BlockedDatesPanel key={`blocked-${user.id}`} user={user} />
        )}
      </main>
    </>
  );
}
