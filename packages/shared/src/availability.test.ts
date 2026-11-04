import { describe, expect, it } from 'vitest';
import {
  emptyWeek,
  generateAvailabilitySlots,
  validateBlockedDate,
  validateWorkingDays,
} from './availability.js';

function week(dayOfWeek: number, startTime: string, endTime: string) {
  return emptyWeek().map((day) =>
    day.dayOfWeek === dayOfWeek ? { ...day, startTime, endTime } : day,
  );
}

describe('weekly working hours and slots', () => {
  it('generates eight 50-minute slots for 09:00-17:00 on each of four Mondays', () => {
    const result = generateAvailabilitySlots(
      week(1, '09:00', '17:00'),
      'UTC',
      '2026-11-02T00:00:00Z',
    );
    expect(result.slots).toHaveLength(32);
    expect(result.fromDate).toBe('2026-11-02');
    expect(result.toDateExclusive).toBe('2026-11-30');
    expect(result.slots[0]).toEqual({
      startsAt: '2026-11-02T09:00:00Z',
      endsAt: '2026-11-02T09:50:00Z',
    });
    expect(result.slots[7]).toEqual({
      startsAt: '2026-11-02T16:00:00Z',
      endsAt: '2026-11-02T16:50:00Z',
    });

    for (const slot of result.slots)
      expect(Date.parse(slot.endsAt) - Date.parse(slot.startsAt)).toBe(
        50 * 60_000,
      );
  });

  it('anchors hourly starts to opening time, and permits ending exactly at closing', () => {
    const result = generateAvailabilitySlots(
      week(1, '09:15', '11:05'),
      'UTC',
      '2026-11-02T00:00:00Z',
    );
    expect(result.slots.slice(0, 2)).toEqual([
      { startsAt: '2026-11-02T09:15:00Z', endsAt: '2026-11-02T10:05:00Z' },
      { startsAt: '2026-11-02T10:15:00Z', endsAt: '2026-11-02T11:05:00Z' },
    ]);
    expect(result.slots).toHaveLength(8);
  });

  it('excludes past slots and a start equal to now', () => {
    const result = generateAvailabilitySlots(
      week(1, '09:00', '12:00'),
      'UTC',
      '2026-11-02T10:00:00Z',
    );
    expect(result.slots[0]!.startsAt).toBe('2026-11-02T11:00:00Z');
  });

  it('uses professional-local dates even when UTC is on the previous day', () => {
    const result = generateAvailabilitySlots(
      week(1, '09:00', '10:00'),
      'Asia/Tokyo',
      '2026-11-01T23:00:00Z',
    );
    expect(result.fromDate).toBe('2026-11-02');
    expect(result.slots[0]!.startsAt).toBe('2026-11-02T00:00:00Z');
  });

  it('handles fractional offsets', () => {
    const result = generateAvailabilitySlots(
      week(1, '09:00', '10:00'),
      'Asia/Kolkata',
      '2026-11-02T00:00:00Z',
    );
    expect(result.slots[0]!.startsAt).toBe('2026-11-02T03:30:00Z');
  });

  it('keeps local hours stable when the UTC offset changes between weeks', () => {
    const result = generateAvailabilitySlots(
      week(1, '09:00', '10:00'),
      'America/New_York',
      '2026-03-02T05:00:00Z',
    );
    expect(result.slots[0]!.startsAt).toBe('2026-03-02T14:00:00Z');
    expect(result.slots[1]!.startsAt).toBe('2026-03-09T13:00:00Z');
  });

  it('skips nonexistent spring-forward slots', () => {
    const result = generateAvailabilitySlots(
      week(7, '00:00', '04:00'),
      'America/New_York',
      '2026-03-08T04:59:00Z',
    );
    const starts = result.slots
      .filter((slot) => slot.startsAt.startsWith('2026-03-08'))
      .map((slot) => slot.startsAt);
    expect(starts).toEqual([
      '2026-03-08T05:00:00Z',
      '2026-03-08T06:00:00Z',
      '2026-03-08T07:00:00Z',
    ]);
  });

  it('skips both occurrences of an ambiguous fall-back slot', () => {
    const result = generateAvailabilitySlots(
      week(7, '00:00', '04:00'),
      'America/New_York',
      '2026-11-01T03:59:00Z',
    );
    const starts = result.slots
      .filter((slot) => slot.startsAt.startsWith('2026-11-01'))
      .map((slot) => slot.startsAt);
    expect(starts).toEqual([
      '2026-11-01T04:00:00Z',
      '2026-11-01T07:00:00Z',
      '2026-11-01T08:00:00Z',
    ]);
  });

  it('skips a session whose end is inside a DST gap', () => {
    const result = generateAvailabilitySlots(
      week(7, '01:30', '04:30'),
      'America/New_York',
      '2026-03-08T05:00:00Z',
    );
    expect(
      result.slots.filter((slot) => slot.startsAt.startsWith('2026-03-08')),
    ).toEqual([
      { startsAt: '2026-03-08T07:30:00Z', endsAt: '2026-03-08T08:20:00Z' },
    ]);
  });

  it('returns no slots for a closed week', () => {
    expect(
      generateAvailabilitySlots(emptyWeek(), 'UTC', '2026-11-02T00:00:00Z')
        .slots,
    ).toEqual([]);
  });

  it.each([
    ['09:00', '09:49'],
    ['17:00', '09:00'],
    ['09:00', '09:00'],
    ['23:30', '24:00'],
    ['9:00', '17:00'],
  ])('rejects invalid hours %s-%s', (start, end) => {
    expect(validateWorkingDays(week(1, start, end))).not.toBeNull();
  });

  it('accepts a single exact 50-minute session', () => {
    const days = week(1, '23:09', '23:59');
    expect(validateWorkingDays(days)).toBeNull();
    expect(
      generateAvailabilitySlots(days, 'UTC', '2026-11-02T00:00:00Z').slots,
    ).toHaveLength(4);
  });

  it('rejects missing days, duplicate days, and half-closed days', () => {
    expect(validateWorkingDays(emptyWeek().slice(1))).not.toBeNull();
    expect(
      validateWorkingDays(emptyWeek().map((day) => ({ ...day, dayOfWeek: 1 }))),
    ).not.toBeNull();
    const days = emptyWeek();
    days[0]!.startTime = '09:00';
    expect(validateWorkingDays(days)).not.toBeNull();
  });
});

it('excludes a slot spanning a 30-minute DST jump even when both endpoints exist', () => {
  const result = generateAvailabilitySlots(
    week(7, '01:50', '04:00'),
    'Australia/Lord_Howe',
    '2026-10-03T13:30:00Z',
  );
  expect(result.slots[0]).toEqual({
    startsAt: '2026-10-03T15:50:00Z',
    endsAt: '2026-10-03T16:40:00Z',
  });
  expect(
    result.slots.some((slot) => slot.startsAt === '2026-10-03T15:20:00Z'),
  ).toBe(false);
});

it('covers all 28 viewer-local dates across opposite sides of the date line', () => {
  const days = emptyWeek().map((day) => ({
    ...day,
    startTime: '00:00',
    endTime: '23:59',
  }));
  const result = generateAvailabilitySlots(
    days,
    'Pacific/Kiritimati',
    '2026-11-02T10:00:00Z',
    'Pacific/Honolulu',
  );
  expect(result.fromDate).toBe('2026-11-02');
  expect(result.toDateExclusive).toBe('2026-11-30');
  expect(
    result.slots.some((slot) => slot.startsAt === '2026-11-30T08:00:00Z'),
  ).toBe(true);
  expect(
    result.slots.every(
      (slot) =>
        Date.parse(slot.startsAt) > Date.parse('2026-11-02T10:00:00Z') &&
        Date.parse(slot.startsAt) < Date.parse('2026-11-30T10:00:00Z'),
    ),
  ).toBe(true);
});

describe('blocked dates', () => {
  const mondays = week(1, '09:00', '17:00');
  const now = '2026-11-02T00:00:00Z';

  it('removes every slot on a blocked date and leaves other dates alone', () => {
    const open = generateAvailabilitySlots(mondays, 'UTC', now);
    const blocked = generateAvailabilitySlots(mondays, 'UTC', now, 'UTC', [
      '2026-11-09',
    ]);
    expect(open.slots).toHaveLength(32);
    expect(blocked.slots).toHaveLength(24);
    expect(
      blocked.slots.some((slot) => slot.startsAt.startsWith('2026-11-09')),
    ).toBe(false);
    expect(blocked.slots).toEqual(
      open.slots.filter((slot) => !slot.startsAt.startsWith('2026-11-09')),
    );
  });

  it('treats an empty or irrelevant blocked list as no restriction', () => {
    const open = generateAvailabilitySlots(mondays, 'UTC', now);
    expect(generateAvailabilitySlots(mondays, 'UTC', now, 'UTC', [])).toEqual(
      open,
    );
    // A Tuesday has no working hours, and a date beyond the window is irrelevant.
    expect(
      generateAvailabilitySlots(mondays, 'UTC', now, 'UTC', [
        '2026-11-03',
        '2027-06-01',
      ]),
    ).toEqual(open);
  });

  it('blocks by the professional-local date, not the UTC or viewer date', () => {
    // 09:00-16:00 NZDT (UTC+13) on Monday 9 November is Sunday 8 November in UTC.
    const hours = week(1, '09:00', '17:00');
    const open = generateAvailabilitySlots(
      hours,
      'Pacific/Auckland',
      '2026-11-01T00:00:00Z',
      'UTC',
    );
    const blocked = generateAvailabilitySlots(
      hours,
      'Pacific/Auckland',
      '2026-11-01T00:00:00Z',
      'UTC',
      ['2026-11-09'],
    );
    const removed = open.slots.filter(
      (slot) => !blocked.slots.some((kept) => kept.startsAt === slot.startsAt),
    );
    expect(removed).toHaveLength(8);
    expect(removed[0]!.startsAt).toBe('2026-11-08T20:00:00Z');
    expect(removed[7]!.startsAt).toBe('2026-11-09T03:00:00Z');
    // Blocking the UTC date of those starts does not remove the Monday sessions.
    expect(
      generateAvailabilitySlots(
        hours,
        'Pacific/Auckland',
        '2026-11-01T00:00:00Z',
        'UTC',
        ['2026-11-08'],
      ).slots,
    ).toHaveLength(open.slots.length);
  });

  it('validates dates against the professional-local today', () => {
    const today = '2026-11-02';
    expect(validateBlockedDate('2026-11-02', today)).toBeNull();
    expect(validateBlockedDate('2026-12-25', today)).toBeNull();
    expect(validateBlockedDate('2027-11-02', today)).toBeNull();
    expect(validateBlockedDate('2027-11-03', today)).toContain('365');
    expect(validateBlockedDate('2026-11-01', today)).toContain('future');
    for (const value of [
      '2026-02-30',
      '2026-13-01',
      '2026-1-5',
      '2026-11-02T10:00',
      'tomorrow',
      '',
      null,
      20261102,
    ])
      expect(validateBlockedDate(value, today)).toBe('Choose a valid date.');
  });
});
