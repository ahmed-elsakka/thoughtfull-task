import {
  emptyWeek,
  timeToMinutes,
  validateWorkingDays,
  type WorkingDay,
} from '@thoughtfull/shared';
import type { SqlDatabase, SqlExecutor } from './auth.js';

export interface AvailabilityStore {
  getWeek(professionalId: string): Promise<WorkingDay[]>;
  replaceWeek(professionalId: string, days: WorkingDay[]): Promise<void>;
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
