import type {
  ProfessionalPage,
  ProfessionalProfile,
} from '@thoughtfull/shared';
import type { SqlDatabase } from './auth.js';

export interface ProfessionalStore {
  list(page: number): Promise<ProfessionalPage>;
  find(id: string): Promise<ProfessionalProfile | null>;
}

export function createProfessionalStore(
  database: SqlDatabase,
): ProfessionalStore {
  return {
    async list(page) {
      const pageSize = 20;
      const { rows } = await database.query<{
        id: string;
        name: string;
        timezone: string;
      }>(
        "SELECT id, name, timezone FROM users WHERE role = 'professional' ORDER BY lower(name), id LIMIT $1 OFFSET $2",
        [pageSize + 1, (page - 1) * pageSize],
      );

      return {
        professionals: rows.slice(0, pageSize),
        nextPage: rows.length > pageSize ? page + 1 : null,
      };
    },

    async find(id) {
      const { rows } = await database.query<{
        id: string;
        name: string;
        timezone: string;
      }>(
        "SELECT id, name, timezone FROM users WHERE id = $1 AND role = 'professional'",
        [id],
      );

      return rows[0] ?? null;
    },
  };
}
