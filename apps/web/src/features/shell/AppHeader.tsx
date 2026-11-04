import { useCallback, useState } from 'react';
import type { User } from '@thoughtfull/shared';
import { NotificationsMenu } from '../notifications/NotificationsMenu';
import { ProfileMenu } from './ProfileMenu';
import { NAVIGATION, type View } from './views';

type Menu = 'notifications' | 'profile' | null;

export function AppHeader({
  user,
  view,
  onLogout,
  loggingOut,
  logoutError,
}: {
  user: User;
  view: View;
  onLogout: () => void;
  loggingOut: boolean;
  logoutError: string | null;
}) {
  const [menu, setMenu] = useState<Menu>(null);
  const close = useCallback(() => setMenu(null), []);

  return (
    <header className="sticky top-0 z-20 border-b border-soft bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <a
          href="/"
          className="text-sm font-semibold uppercase tracking-[0.25em] text-ink hover:opacity-80"
        >
          ThoughtFull
        </a>
        <nav
          aria-label="Main"
          className="order-last -mx-1 flex w-full gap-1 overflow-x-auto px-1 sm:order-none sm:mx-0 sm:w-auto sm:px-0"
        >
          {NAVIGATION[user.role].map((item) => (
            <a
              key={item.view}
              href={item.href}
              aria-current={item.view === view ? 'page' : undefined}
              onClick={close}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${item.view === view ? 'bg-ink text-white' : 'text-ink hover:bg-[#f0f7f9]'}`}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NotificationsMenu
            user={user}
            open={menu === 'notifications'}
            onToggle={() =>
              setMenu(menu === 'notifications' ? null : 'notifications')
            }
            onClose={close}
          />
          <ProfileMenu
            user={user}
            open={menu === 'profile'}
            onToggle={() => setMenu(menu === 'profile' ? null : 'profile')}
            onClose={close}
            onLogout={onLogout}
            loggingOut={loggingOut}
            error={logoutError}
          />
        </div>
      </div>
    </header>
  );
}
