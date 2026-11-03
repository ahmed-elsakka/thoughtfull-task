import Fastify from 'fastify';

export function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  app.get('/api/health', async () => ({ status: 'ok' }));
  return app;
}
