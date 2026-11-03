import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AvailabilityPanel } from './features/availability/AvailabilityPanel';
import { ProfessionalDirectory } from './features/professionals/ProfessionalDirectory';
import { AuthScreen } from './features/auth/AuthScreen';
import { currentUser, authRequest } from './lib/auth';

export function App() {
  const cache = useQueryClient();
  const account = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: currentUser,
    retry: false,
    staleTime: 0,
  });
  const logout = useMutation({
    mutationFn: () => authRequest('logout'),
    onSuccess: () => {
      cache.clear();
      cache.setQueryData(['auth', 'me'], null);
    },
  });

  return (
    <main className="mx-auto max-w-xl px-5 py-12 sm:py-20">
      <p className="mb-8 text-sm font-semibold uppercase tracking-[0.25em] text-ink">
        ThoughtFull
      </p>
      {account.isPending ? (
        <p role="status">Loading your account...</p>
      ) : account.isError ? (
        <section>
          <p role="alert">{account.error.message}</p>
          <button className="primary mt-4" onClick={() => account.refetch()}>
            Try again
          </button>
        </section>
      ) : account.data ? (
        <>
          <section className="rounded-3xl auth-card p-8">
            <h1 className="text-3xl font-semibold text-ink">
              Hello, {account.data.name}
            </h1>
            <p className="mt-3 text-copy">
              You are logged in to your ThoughtFull account.
            </p>
            <dl className="my-7 space-y-3">
              <div>
                <dt className="text-sm text-muted">Email</dt>
                <dd className="break-all">{account.data.email}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Account type</dt>
                <dd className="capitalize">{account.data.role}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Timezone</dt>
                <dd>{account.data.timezone}</dd>
              </div>
            </dl>
            {logout.error && (
              <p role="alert" className="mb-4 text-red-800">
                {logout.error.message}
              </p>
            )}
            <button
              className="primary"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              {logout.isPending ? 'Logging out...' : 'Log out'}
            </button>
          </section>
          {account.data.role === 'member' && (
            <ProfessionalDirectory
              key={account.data.id}
              memberId={account.data.id}
            />
          )}
          {account.data.role === 'professional' && (
            <AvailabilityPanel key={account.data.id} user={account.data} />
          )}
        </>
      ) : (
        <AuthScreen />
      )}
    </main>
  );
}
