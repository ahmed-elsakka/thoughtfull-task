import { Temporal } from '@js-temporal/polyfill';
import { SESSION_DURATION_MINUTES } from './constants.js';

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export const SLOT_DURATION_MINUTES = SESSION_DURATION_MINUTES;
export const SLOT_INTERVAL_MINUTES = 60;

export interface WorkingDay {
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
}

export interface WeeklyAvailability {
  timezone: string;
  days: WorkingDay[];
}

export const BLOCKED_DATE_HORIZON_DAYS = 365;

export interface BlockedDate {
  date: string;
  confirmedSessions: number;
}

export interface BlockedDates {
  timezone: string;
  dates: BlockedDate[];
}

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
}

export interface SlotPreview {
  timezone: string;
  fromDate: string;
  toDateExclusive: string;
  slots: AvailabilitySlot[];
}

export function emptyWeek(): WorkingDay[] {
  return WEEKDAYS.map((_, index) => ({
    dayOfWeek: index + 1,
    startTime: null,
    endTime: null,
  }));
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);

  return hours! * 60 + minutes!;
}

export function validateWorkingDays(days: WorkingDay[]): string | null {
  if (
    days.length !== 7 ||
    new Set(days.map((day) => day.dayOfWeek)).size !== 7
  ) {
    return 'Include each day of the week exactly once.';
  }

  for (const day of days) {
    if (
      !Number.isInteger(day.dayOfWeek) ||
      day.dayOfWeek < 1 ||
      day.dayOfWeek > 7
    ) {
      return 'Days must be Monday (1) through Sunday (7).';
    }

    if (day.startTime === null && day.endTime === null) continue;

    const validTime = (time: unknown): time is string =>
      typeof time === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time);

    if (!validTime(day.startTime) || !validTime(day.endTime)) {
      return 'Set both opening and closing times, or mark the day closed.';
    }

    const duration = timeToMinutes(day.endTime) - timeToMinutes(day.startTime);

    if (duration < SLOT_DURATION_MINUTES) {
      return `${WEEKDAYS[day.dayOfWeek - 1]} must have at least 50 minutes of working time, ending on the same day.`;
    }
  }

  return null;
}

export function todayInTimezone(now: Date, timezone: string): string {
  return Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}

// Blocked dates are calendar dates in the professional's own timezone.
export function validateBlockedDate(
  date: unknown,
  today: string,
): string | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return 'Choose a valid date.';

  let parsed: Temporal.PlainDate;

  try {
    parsed = Temporal.PlainDate.from(date, { overflow: 'reject' });
  } catch {
    return 'Choose a valid date.';
  }

  const first = Temporal.PlainDate.from(today);

  if (Temporal.PlainDate.compare(parsed, first) < 0)
    return 'Choose today or a future date.';

  if (
    Temporal.PlainDate.compare(
      parsed,
      first.add({ days: BLOCKED_DATE_HORIZON_DAYS }),
    ) > 0
  )
    return `Choose a date within the next ${BLOCKED_DATE_HORIZON_DAYS} days.`;

  return null;
}

export function generateAvailabilitySlots(
  days: WorkingDay[],
  timezone: string,
  now: string,
  viewerTimezone = timezone,
  blockedDates: readonly string[] = [],
): SlotPreview {
  const error = validateWorkingDays(days);

  if (error) throw new RangeError(error);

  const instant = Temporal.Instant.from(now);
  const firstDate = instant.toZonedDateTimeISO(viewerTimezone).toPlainDate();
  const lastDate = firstDate.add({ days: 28 });
  const windowStart = firstDate.toZonedDateTime(viewerTimezone).toInstant();
  const windowEnd = lastDate.toZonedDateTime(viewerTimezone).toInstant();
  const professionalStart = windowStart
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
  const professionalEnd = windowEnd
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .add({ days: 1 });
  const slots: AvailabilitySlot[] = [];
  const blocked = new Set(blockedDates);

  for (
    let date = professionalStart;
    Temporal.PlainDate.compare(date, professionalEnd) < 0;
    date = date.add({ days: 1 })
  ) {
    const day = days.find((value) => value.dayOfWeek === date.dayOfWeek)!;

    if (day.startTime === null || day.endTime === null) continue;

    // A blocked date removes every slot that starts on that professional-local date.
    if (blocked.has(date.toString())) continue;

    const closing = timeToMinutes(day.endTime);

    for (
      let minute = timeToMinutes(day.startTime);
      minute + SLOT_DURATION_MINUTES <= closing;
      minute += SLOT_INTERVAL_MINUTES
    ) {
      const localStart = date.toPlainDateTime({
        hour: Math.floor(minute / 60),
        minute: minute % 60,
      });
      const localEnd = localStart.add({ minutes: SLOT_DURATION_MINUTES });

      try {
        // Do not silently shift nonexistent times or choose one occurrence of a repeated time.
        const start = localStart
          .toZonedDateTime(timezone, { disambiguation: 'reject' })
          .toInstant();
        const end = localEnd
          .toZonedDateTime(timezone, { disambiguation: 'reject' })
          .toInstant();

        if (Temporal.Instant.compare(start, instant) <= 0) continue;

        if (
          Temporal.Instant.compare(start, windowStart) < 0 ||
          Temporal.Instant.compare(start, windowEnd) >= 0
        )
          continue;

        // Also exclude sessions that cross an offset change and are not 50 elapsed minutes.
        if (
          end.epochMilliseconds - start.epochMilliseconds !==
          SLOT_DURATION_MINUTES * 60_000
        )
          continue;

        slots.push({ startsAt: start.toString(), endsAt: end.toString() });
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
  }

  return {
    timezone: viewerTimezone,
    fromDate: firstDate.toString(),
    toDateExclusive: lastDate.toString(),
    slots,
  };
}
