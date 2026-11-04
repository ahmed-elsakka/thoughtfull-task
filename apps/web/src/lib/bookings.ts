import type {
  BookingRequest,
  BookingResult,
  SlotPreview,
  SessionPage,
  SessionPeriod,
  SessionChangeRequest,
  RescheduleRequest,
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

export const getMySessions = (period: SessionPeriod, page: number) =>
  request<SessionPage>(`/api/sessions?period=${period}&page=${page}`);

export const getRescheduleSlots = (id: string) =>
  request<SlotPreview>(
    `/api/sessions/${encodeURIComponent(id)}/reschedule-slots`,
  );

export const changeSession = (
  id: string,
  action: 'cancel' | 'reschedule',
  input: SessionChangeRequest | RescheduleRequest,
) =>
  request<{ message: string }>(
    `/api/sessions/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'ThoughtFull',
      },
      body: JSON.stringify(input),
    },
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
