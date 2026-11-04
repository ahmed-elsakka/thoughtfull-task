export interface Notification {
  id: string;
  bookingId: string;
  counterpartName: string;
  sessionStartsAt: string;
  offsetMinutes: 60 | 1440;
  scheduledAt: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  notifications: Notification[];
  unreadCount: number;
  nextPage: number | null;
}
