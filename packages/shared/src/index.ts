export type UserRole = 'member' | 'professional';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  timezone: string;
}

export { SESSION_DURATION_MINUTES } from './constants.js';

export * from './availability.js';

export * from './professionals.js';

export * from './bookings.js';
