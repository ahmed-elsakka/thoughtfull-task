import type {
  BookingRequest,
  BookingResult,
  SlotPreview,
} from '@thoughtfull/shared';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const result = await response.json();

  if (!response.ok)
    throw new Error(
      result.message ?? 'Unable to complete this request. Please try again.',
    );

  return result as T;
}

export const getBookingCalendar = (professionalId: string) =>
  request<SlotPreview>(
    `/api/professionals/${encodeURIComponent(professionalId)}/slots`,
  );

export const createBooking = (input: BookingRequest) =>
  request<BookingResult>('/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'ThoughtFull',
    },
    body: JSON.stringify(input),
  });
