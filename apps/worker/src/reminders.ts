import { setTimeout } from 'node:timers/promises';
import type { NotificationStore } from '@thoughtfull/db';

export async function runReminderWorker(
  store: Pick<NotificationStore, 'deliverDue'>,
  signal: AbortSignal,
  reportError: (error: unknown) => void = console.error,
  pollIntervalMs = 5000,
) {
  while (!signal.aborted) {
    try {
      await store.deliverDue();
    } catch (error) {
      // Transactions leave failed work pending. Retry on the next pass.
      reportError(error);
    }

    if (signal.aborted) break;

    try {
      await setTimeout(pollIntervalMs, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
