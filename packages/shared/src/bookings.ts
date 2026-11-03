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
