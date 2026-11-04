import {
  emptyWeek,
  type BlockedDate,
  timeToMinutes,
  validateWorkingDays,
  type WorkingDay,
} from '@thoughtfull/shared';
import type { SqlDatabase, SqlExecutor } from './auth.js';

export interface AvailabilityStore {
  getWeek(professionalId: string): Promise<WorkingDay[]>;
  replaceWeek(professionalId: string, days: WorkingDay[]): Promise<void>;
  listBlockedDates(
    professionalId: string,
    today: string,
  ): Promise<BlockedDate[]>;
  blockDate(professionalId: string, date: string): Promise<boolean>;
  unblockDate(professionalId: string, date: string): Promise<void>;
}

function minuteToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function createAvailabilityStore(
  database: SqlDatabase,
): AvailabilityStore {
  return {
    async getWeek(professionalId) {
      return readWorkingWeek(database, professionalId);
    },

    async listBlockedDates(professionalId, today) {
      const { rows } = await database.query<{
        blocked_date: string;
        sessions: string;
      }>(
        `SELECT d.blocked_date::text AS blocked_date,
           (SELECT count(*) FROM bookings b
            WHERE b.professional_id = d.professional_id AND b.status = 'confirmed'
            AND (b.starts_at AT TIME ZONE u.timezone)::date = d.blocked_date) AS sessions
         FROM professional_blocked_dates d JOIN users u ON u.id = d.professional_id
         WHERE d.professional_id = $1 AND d.blocked_date >= $2::date
         ORDER BY d.blocked_date`,
        [professionalId, today],
      );

      return rows.map((row) => ({
        date: row.blocked_date,
        confirmedSessions: Number(row.sessions),
      }));
    },

    async blockDate(professionalId, date) {
      return database.transaction(async (db) => {
        // Same professional row lock as bookings and working-hours updates.
        const { rows: owner } = await db.query(
          "SELECT id FROM users WHERE id = $1 AND role = 'professional' FOR UPDATE",
          [professionalId],
        );

        if (owner.length !== 1) throw new Error('Professional not found.');

        const { rows } = await db.query(
          'INSERT INTO professional_blocked_dates (professional_id, blocked_date) VALUES ($1, $2::date) ON CONFLICT DO NOTHING RETURNING blocked_date',
          [professionalId, date],
        );

        return rows.length === 1;
      });
    },

    async unblockDate(professionalId, date) {
      await database.transaction(async (db) => {
        await db.query(
          "SELECT id FROM users WHERE id = $1 AND role = 'professional' FOR UPDATE",
          [professionalId],
        );
        await db.query(
          'DELETE FROM professional_blocked_dates WHERE professional_id = $1 AND blocked_date = $2::date',
          [professionalId, date],
        );
      });
    },

    async replaceWeek(professionalId, days) {
      const error = validateWorkingDays(days);

      if (error) throw new RangeError(error);

      await database.transaction(async (db) => {
        // Serializes concurrent replacements, including the initially empty week.
        const { rows } = await db.query(
          "SELECT id FROM users WHERE id = $1 AND role = 'professional' FOR UPDATE",
          [professionalId],
        );

        if (rows.length !== 1) throw new Error('Professional not found.');

        await db.query(
          'DELETE FROM professional_availability WHERE professional_id = $1',
          [professionalId],
        );

        for (const day of days) {
          if (day.startTime === null || day.endTime === null) continue;

          await db.query(
            'INSERT INTO professional_availability (professional_id, day_of_week, start_minute, end_minute) VALUES ($1, $2, $3, $4)',
            [
              professionalId,
              day.dayOfWeek,
              timeToMinutes(day.startTime),
              timeToMinutes(day.endTime),
            ],
          );
        }
      });
    },
  };
}

export async function readBlockedDates(
  database: SqlExecutor,
  professionalId: string,
): Promise<string[]> {
  const { rows } = await database.query<{ blocked_date: string }>(
    'SELECT blocked_date::text AS blocked_date FROM professional_blocked_dates WHERE professional_id = $1',
    [professionalId],
  );

  return rows.map((row) => row.blocked_date);
}

export async function readWorkingWeek(
  database: SqlExecutor,
  professionalId: string,
): Promise<WorkingDay[]> {
  const { rows } = await database.query<{
    day_of_week: number;
    start_minute: number;
    end_minute: number;
  }>(
    'SELECT day_of_week, start_minute, end_minute FROM professional_availability WHERE professional_id = $1 ORDER BY day_of_week',
    [professionalId],
  );

  return emptyWeek().map((day) => {
    const row = rows.find((value) => value.day_of_week === day.dayOfWeek);

    return row
      ? {
          ...day,
          startTime: minuteToTime(row.start_minute),
          endTime: minuteToTime(row.end_minute),
        }
      : day;
  });
}
