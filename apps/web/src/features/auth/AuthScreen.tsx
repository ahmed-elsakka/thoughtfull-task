import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authRequest } from '../../lib/auth';

const browserTimezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const timezones = [
  ...new Set(['UTC', browserTimezone, ...Intl.supportedValuesOf('timeZone')]),
].sort();

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) => authRequest(mode, body),
    onSuccess: (user) => cache.setQueryData(['auth', 'me'], user),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: Record<string, string> = {
      email: String(data.get('email')).trim(),
      password: String(data.get('password')),
    };

    if (mode === 'signup')
      Object.assign(body, {
        name: String(data.get('name')).trim(),
        role: String(data.get('role')),
        timezone: String(data.get('timezone')),
      });

    mutation.mutate(body);
  }

  return (
    <section className="rounded-3xl auth-card p-7 sm:p-10">
      <h1 className="text-3xl font-semibold text-ink">
        {mode === 'login' ? 'Welcome back' : 'Create your account'}
      </h1>
      <p className="mt-3 text-copy">
        {mode === 'login'
          ? 'Log in to your ThoughtFull account.'
          : 'Join as a member or a professional.'}
      </p>
      <form key={mode} onSubmit={submit} className="mt-8 space-y-5">
        {mode === 'signup' && (
          <label className="field">
            Full name
            <input name="name" autoComplete="name" required maxLength={100} />
          </label>
        )}
        <label className="field">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <label className="field">
          Password
          <input
            name="password"
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            required
            minLength={mode === 'signup' ? 12 : 1}
            maxLength={128}
            aria-describedby={mode === 'signup' ? 'password-help' : undefined}
          />
        </label>
        {mode === 'signup' && (
          <>
            <p id="password-help" className="text-sm text-muted">
              Use 12 characters. A long, unique passphrase works well.
            </p>
            <label className="field">
              Account type
              <select name="role" defaultValue="member">
                <option value="member">Member - seeking support</option>
                <option value="professional">
                  Professional - providing support
                </option>
              </select>
            </label>
            <label className="field">
              Timezone
              <select name="timezone" defaultValue={browserTimezone}>
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {mutation.error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {mutation.error.message}
          </p>
        )}
        <button className="primary w-full" disabled={mutation.isPending}>
          {mutation.isPending
            ? 'Please wait¦'
            : mode === 'login'
              ? 'Log in'
              : 'Create account'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-copy">
        {mode === 'login'
          ? 'New to ThoughtFull? '
          : 'Already have an account? '}
        <button
          type="button"
          className="font-semibold text-link underline underline-offset-4"
          disabled={mutation.isPending}
          onClick={() => {
            mutation.reset();
            setMode(mode === 'login' ? 'signup' : 'login');
          }}
        >
          {mode === 'login' ? 'Sign up' : 'Log in'}
        </button>
      </p>
    </section>
  );
}
