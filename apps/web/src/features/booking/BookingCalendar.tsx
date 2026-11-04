import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AvailabilitySlot,
  Booking,
  ProfessionalProfile,
} from '@thoughtfull/shared';
import { MIN_BOOKING_NOTICE_MINUTES } from '@thoughtfull/shared';
import { createBooking, getBookingCalendar } from '../../lib/bookings';

function localDate(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function calendarDates(from: string, until: string) {
  const dates: string[] = [];
  const date = new Date(`${from}T12:00:00Z`);

  while (date.toISOString().slice(0, 10) < until) {
    dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return dates;
}

export function BookingCalendar({
  professional,
  memberId,
}: {
  professional: ProfessionalProfile;
  memberId: string;
}) {
  const cache = useQueryClient();
  const calendar = useQuery({
    queryKey: ['booking-calendar', memberId, professional.id],
    queryFn: () => getBookingCalendar(professional.id),
    refetchInterval: 30_000,
    retry: false,
  });
  const [day, setDay] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    slot: AvailabilitySlot;
    requestId: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState<Booking | null>(null);
  const booking = useMutation({
    mutationFn: createBooking,
    onSuccess: async (result) => {
      setConfirmed(result.booking);
      setSelection(null);
      await cache.invalidateQueries({
        queryKey: ['booking-calendar', memberId],
      });
      await cache.invalidateQueries({ queryKey: ['availability-slots'] });
      await cache.invalidateQueries({ queryKey: ['my-sessions', memberId] });
    },
    onError: () => {
      void cache.invalidateQueries({
        queryKey: ['booking-calendar', memberId],
      });
    },
  });

  if (calendar.isPending)
    return (
      <p role="status" className="mt-8">
        Loading available dates...
      </p>
    );

  if (calendar.isError)
    return (
      <div className="mt-8">
        <p role="alert">{calendar.error.message}</p>
        <button
          type="button"
          className="primary mt-3"
          onClick={() => calendar.refetch()}
        >
          Retry calendar
        </button>
      </div>
    );

  const { timezone, slots, fromDate, toDateExclusive } = calendar.data;
  const timeFormat = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  });
  const fullFormat = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const dateFormat = new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const dates = calendarDates(fromDate, toDateExclusive);
  const selectedDay =
    day ?? (slots[0] ? localDate(slots[0].startsAt, timezone) : fromDate);
  const slotsByDate = new Map<string, AvailabilitySlot[]>();

  for (const slot of slots) {
    const key = localDate(slot.startsAt, timezone);
    slotsByDate.set(key, [...(slotsByDate.get(key) ?? []), slot]);
  }

  function chooseDate(date: string) {
    setDay(date);
    setSelection(null);
    booking.reset();
  }

  const leadingDays = (new Date(`${fromDate}T12:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <section
      className="mt-8 border-t border-soft pt-6"
      aria-label="Book a session"
    >
      <h3 className="text-xl font-semibold text-ink">Choose a date and time</h3>
      <p className="mt-2 text-sm text-copy">
        Next 4 weeks. All dates and times are shown in your timezone:{' '}
        <strong>{timezone}</strong>. Sessions must be booked at least{' '}
        {MIN_BOOKING_NOTICE_MINUTES / 60} hours ahead.
      </p>
      {confirmed && (
        <div
          role="status"
          className="mt-5 rounded-xl border border-link bg-mint/30 p-4"
        >
          <h4 className="font-semibold text-ink">Booking confirmed</h4>
          <p className="mt-2">
            Your 50-minute session with {professional.name} starts{' '}
            {fullFormat.format(new Date(confirmed.startsAt))} ({timezone}).
          </p>
          <p className="mt-2 break-all text-xs text-muted">
            Booking reference: {confirmed.id}
          </p>
        </div>
      )}
      {selection ? (
        <div className="mt-6 rounded-xl border border-soft bg-soft/20 p-5">
          <h4 className="text-lg font-semibold text-ink">
            Confirm your session
          </h4>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-muted">Professional</dt>
              <dd className="font-medium">{professional.name}</dd>
            </div>
            <div>
              <dt className="text-muted">Date and time</dt>
              <dd className="font-medium">
                {fullFormat.format(new Date(selection.slot.startsAt))}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Ends at</dt>
              <dd>{timeFormat.format(new Date(selection.slot.endsAt))}</dd>
            </div>
            <div>
              <dt className="text-muted">Your timezone</dt>
              <dd>{timezone}</dd>
            </div>
            <div>
              <dt className="text-muted">Duration</dt>
              <dd>50 minutes</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted">
            This time is reserved only after you confirm.
          </p>
          {booking.error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            >
              {booking.error.message}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="primary"
              disabled={booking.isPending}
              onClick={() =>
                booking.mutate({
                  professionalId: professional.id,
                  startsAt: selection.slot.startsAt,
                  requestId: selection.requestId,
                })
              }
            >
              {booking.isPending ? 'Booking...' : 'Confirm booking'}
            </button>
            <button
              className="font-semibold text-link underline underline-offset-4"
              disabled={booking.isPending}
              onClick={() => {
                setSelection(null);
                booking.reset();
              }}
            >
              Choose another time
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className="mt-6 grid grid-cols-7 gap-1 text-center"
            role="group"
            aria-label="Available dates"
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
              <span key={label} className="py-2 text-xs text-muted">
                {label}
              </span>
            ))}
            {Array.from({ length: leadingDays }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden="true" />
            ))}
            {dates.map((date) => {
              const count = slotsByDate.get(date)?.length ?? 0;
              const label = dateFormat.format(new Date(`${date}T12:00:00Z`));

              return (
                <button
                  key={date}
                  type="button"
                  aria-label={`${label}, ${count} available slots`}
                  aria-pressed={date === selectedDay}
                  disabled={count === 0}
                  className={`calendar-date rounded-lg border px-1 py-2 text-sm ${date === selectedDay ? 'border-ink bg-ink text-white' : 'border-soft text-ink'}`}
                  onClick={() => chooseDate(date)}
                >
                  <span className="block text-[10px]">
                    {new Intl.DateTimeFormat('en', {
                      timeZone: 'UTC',
                      month: 'short',
                    }).format(new Date(`${date}T12:00:00Z`))}
                  </span>
                  {Number(date.slice(8))}
                </button>
              );
            })}
          </div>
          <h4 className="mt-6 font-semibold text-ink">
            {dateFormat.format(new Date(`${selectedDay}T12:00:00Z`))}
          </h4>
          {slots.length === 0 ? (
            <p className="mt-3 text-copy">
              No available sessions in the next four weeks. Please check another
              professional or return later.
            </p>
          ) : (slotsByDate.get(selectedDay)?.length ?? 0) === 0 ? (
            <p className="mt-3 text-copy">
              No available times on this date. Choose another date.
            </p>
          ) : (
            <div
              className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
              role="group"
              aria-label="Available times"
            >
              {slotsByDate.get(selectedDay)!.map((slot) => (
                <button
                  key={slot.startsAt}
                  className="rounded-lg border border-soft px-3 py-3 text-sm font-medium text-ink hover:bg-mint/30"
                  onClick={() => {
                    setDay(selectedDay);
                    setConfirmed(null);
                    booking.reset();
                    setSelection({ slot, requestId: crypto.randomUUID() });
                  }}
                >
                  {timeFormat.format(new Date(slot.startsAt))}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
