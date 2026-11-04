export interface Booking {
  id: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled';
}

export interface BookingRequest {
  professionalId: string;
  startsAt: string;
  requestId: string;
}

export interface BookingResult {
  booking: Booking;
  replayed: boolean;
}

export type SessionPeriod = 'upcoming' | 'past';

export interface SessionSummary {
  id: string;
  counterpartName: string;
  startsAt: string;
  endsAt: string;
  status: Booking['status'];
}

export interface SessionPage {
  sessions: SessionSummary[];
  nextPage: number | null;
}

export interface SessionChangeRequest {
  expectedStartsAt: string;
}

export interface RescheduleRequest extends SessionChangeRequest {
  startsAt: string;
}

export const MEMBER_CHANGE_NOTICE_MS = 24 * 60 * 60 * 1000;
