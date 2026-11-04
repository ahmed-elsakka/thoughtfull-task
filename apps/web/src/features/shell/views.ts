import type { UserRole } from '@thoughtfull/shared';

export type View = 'find' | 'sessions' | 'availability' | 'blocked';

export interface NavItem {
  view: View;
  label: string;
  href: string;
  title: string;
}

const find: NavItem = {
  view: 'find',
  label: 'Find a Professional',
  href: '#professionals',
  title: 'Professional directory',
};
const sessions: NavItem = {
  view: 'sessions',
  label: 'My Sessions',
  href: '#sessions',
  title: 'Session schedule',
};
const availability: NavItem = {
  view: 'availability',
  label: 'Availability',
  href: '#availability',
  title: 'Availability settings',
};
const blocked: NavItem = {
  view: 'blocked',
  label: 'Blocked Dates',
  href: '#blocked-dates',
  title: 'Blocked date settings',
};

export const NAVIGATION: Record<UserRole, NavItem[]> = {
  member: [find, sessions],
  professional: [sessions, availability, blocked],
};

// The first item of each list is the view an account opens on.
export function viewFromHash(role: UserRole, hash: string): NavItem {
  const items = NAVIGATION[role];
  // Profile pages live under #professionals/<id>, so match by prefix.
  const match = items.find(
    (item) => hash === item.href || hash.startsWith(`${item.href}/`),
  );

  return match ?? items[0]!;
}
