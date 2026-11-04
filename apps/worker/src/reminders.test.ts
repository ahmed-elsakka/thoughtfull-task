import { expect, it, vi } from 'vitest';
import { runReminderWorker } from './reminders.js';

it('retries a failed pass on the next interval and stops on shutdown', async () => {
  const shutdown = new AbortController();
  const error = new Error('temporary database failure');
  const report = vi.fn();
  const deliverDue = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockImplementationOnce(async () => {
      shutdown.abort();

      return 2;
    });
  await runReminderWorker({ deliverDue }, shutdown.signal, report, 5);
  expect(report).toHaveBeenCalledWith(error);
  expect(deliverDue).toHaveBeenCalledTimes(2);
});

it('waits for an in-flight pass to finish before shutting down', async () => {
  const shutdown = new AbortController();
  let finish!: (count: number) => void;
  const deliverDue = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  let stopped = false;
  const running = runReminderWorker({ deliverDue }, shutdown.signal).then(
    () => {
      stopped = true;
    },
  );
  shutdown.abort();
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish(2);
  await running;
  expect(stopped).toBe(true);
  expect(deliverDue).toHaveBeenCalledTimes(1);
});
