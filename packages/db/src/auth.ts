export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'professional';
  timezone: string;
}

export interface Credentials extends AuthUser {
  passwordHash: string;
}

export interface Session {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export interface AuthStore {
  createUser(user: Credentials, session: Session): Promise<void>;
  findCredentials(email: string): Promise<Credentials | null>;
  createSession(session: Session, previousTokenHash?: string): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<AuthUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export interface SqlExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface SqlDatabase extends SqlExecutor {
  transaction<T>(run: (client: SqlExecutor) => Promise<T>): Promise<T>;
}

export class EmailTakenError extends Error {}

const columns = 'u.id, u.name, u.email, u.role, u.timezone';

export function createAuthStore(database: SqlDatabase): AuthStore {
  const insertSession = (db: SqlExecutor, s: Session) =>
    db.query(
      'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)',
      [s.tokenHash, s.userId, s.expiresAt],
    );

  return {
    async createUser(user, session) {
      try {
        await database.transaction(async (db) => {
          await db.query(
            'INSERT INTO users (id,name,email,password_hash,role,timezone) VALUES ($1,$2,$3,$4,$5,$6)',
            [
              user.id,
              user.name,
              user.email,
              user.passwordHash,
              user.role,
              user.timezone,
            ],
          );

          await insertSession(db, session);
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === '23505' &&
          'constraint' in error &&
          error.constraint === 'users_email_unique'
        )
          throw new EmailTakenError();

        throw error;
      }
    },

    async findCredentials(email) {
      const { rows } = await database.query(
        `SELECT ${columns}, u.password_hash AS "passwordHash" FROM users u WHERE email=$1`,
        [email],
      );

      return (rows[0] as unknown as Credentials) ?? null;
    },

    async createSession(session, previousTokenHash) {
      await database.transaction(async (db) => {
        if (previousTokenHash)
          await db.query('DELETE FROM auth_sessions WHERE token_hash=$1', [
            previousTokenHash,
          ]);

        await insertSession(db, session);
      });
    },

    async findSession(tokenHash, now) {
      const { rows } = await database.query(
        `SELECT ${columns} FROM users u JOIN auth_sessions s ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > $2`,
        [tokenHash, now],
      );

      return (rows[0] as unknown as AuthUser) ?? null;
    },

    async deleteSession(tokenHash) {
      await database.query('DELETE FROM auth_sessions WHERE token_hash=$1', [
        tokenHash,
      ]);
    },
  };
}
