import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx tests/support/auth-server.ts',
      url: 'http://127.0.0.1:3001/api/health',
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -w @thoughtfull/web -- --mode e2e --port 5174',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
    },
  ],
});
