import { expect, it } from 'vitest';
import { buildApp } from './app.js';

it('boots the API and serves the health endpoint', async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  } finally {
    await app.close();
  }
});
