import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthScreen } from './features/auth/AuthScreen';
import { AppShell } from './features/shell/AppShell';
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

  if (account.data)
    return (
      <AppShell
        user={account.data}
        onLogout={() => logout.mutate()}
        loggingOut={logout.isPending}
        logoutError={logout.error?.message ?? null}
      />
    );

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
      ) : (
        <AuthScreen />
      )}
    </main>
  );
}
