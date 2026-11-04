import { useRef } from 'react';
import type { User } from '@thoughtfull/shared';
import { UserIcon } from './icons';
import { useDismiss } from './useDismiss';

export function ProfileMenu({
  user,
  open,
  onToggle,
  onClose,
  onLogout,
  loggingOut,
  error,
}: {
  user: User;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  error: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useDismiss(container, trigger, open, onClose);

  return (
    <div ref={container} className="sm:relative">
      <button
        ref={trigger}
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls="account-panel"
        onClick={onToggle}
        className="grid h-10 w-10 place-items-center rounded-full border border-soft bg-white text-ink hover:bg-[#f0f7f9]"
      >
        <UserIcon />
      </button>
      {open && (
        <section
          id="account-panel"
          aria-label="Account"
          className="auth-card absolute inset-x-4 top-full z-30 mt-2 rounded-2xl p-5 sm:inset-x-auto sm:right-0 sm:w-80"
        >
          <p className="break-words text-lg font-semibold text-ink">
            {user.name}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-muted">Email</dt>
              <dd className="break-all">{user.email}</dd>
            </div>
            <div>
              <dt className="text-muted">Account type</dt>
              <dd className="capitalize">{user.role}</dd>
            </div>
            <div>
              <dt className="text-muted">Timezone</dt>
              <dd>{user.timezone}</dd>
            </div>
          </dl>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {error}
            </p>
          )}
          <button
            type="button"
            className="primary mt-4 w-full"
            disabled={loggingOut}
            onClick={onLogout}
          >
            {loggingOut ? 'Logging out...' : 'Log out'}
          </button>
        </section>
      )}
    </div>
  );
}
