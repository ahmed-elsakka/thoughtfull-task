import type { User } from '@thoughtfull/shared';

export async function currentUser(): Promise<User | null> {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' });

  if (response.status === 401) return null;

  if (!response.ok)
    throw new Error('Unable to load your account. Please try again.');

  return (await response.json()).user;
}

export async function authRequest(
  path: string,
  body?: unknown,
): Promise<User | null> {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'ThoughtFull',
    },
    body: JSON.stringify(body ?? {}),
  });

  if (response.status === 204) return null;

  const result = await response.json();

  if (!response.ok)
    throw new Error(result.message ?? 'Request failed. Please try again.');

  return result.user;
}
