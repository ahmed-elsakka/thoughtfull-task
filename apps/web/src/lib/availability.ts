import type {
  SlotPreview,
  WeeklyAvailability,
  WorkingDay,
} from '@thoughtfull/shared';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
  });
  const result = await response.json();

  if (!response.ok)
    throw new Error(result.message ?? 'Unable to load availability.');

  return result as T;
}

export const getAvailability = () =>
  request<WeeklyAvailability>('/api/professional/availability');

export const getSlotPreview = () =>
  request<SlotPreview>('/api/professional/availability/slots');

export const saveAvailability = (days: WorkingDay[]) =>
  request<WeeklyAvailability>('/api/professional/availability', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'ThoughtFull',
    },
    body: JSON.stringify({ days }),
  });
