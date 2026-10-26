// What the calendar endpoints send (see src/server/calendar-events.ts and calendar-connections.ts).
export type Tone = "purple" | "pink" | "red" | "blue" | "green" | "amber";
export type CalSource = "birthday" | "anniversary" | "occasion" | "gift" | "santa" | "manual" | "external";

export type CalEvent = {
  id: string;
  source: CalSource;
  title: string;
  allDay: boolean;
  /** all day: "YYYY-MM-DD". timed: "...Z" (an instant) or "YYYY-MM-DDTHH:MM:SS" (as written, no zone) */
  start: string;
  /** all day: "YYYY-MM-DD", exclusive */
  end: string;
  tone: Tone;
  personId: string | null;
  note?: string;
  location?: string;
  turning?: number;
  toBuy?: { personId: string; name: string }[];
  covered?: number;
  occasion?: string;
  manualId?: string;
  yearly?: boolean;
  shared?: boolean;
  canEdit?: boolean;
  connectionId?: string;
  connectionName?: string;
  sharedBy?: string;
  exchangeId?: string;
  giftId?: string;
};

export type CalSummary = {
  today: string;
  week: { from: string; to: string };
  eventsThisWeek: number;
  birthdaysIn30: number;
  giftsNeeded: number;
  giftEventsNeeded: number;
  todayTones: Tone[];
  todayCount: number;
  pendingReviews: number;
};

export type ManualInput = {
  title: string;
  date: string;
  allDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
  personId?: string | null;
  yearly?: boolean;
  shared?: boolean;
  notes?: string;
};
export type ManualEvent = ManualInput & { id: string; mine: boolean };

export type ConnectionKind = "ics_url" | "ics_file" | "google" | "caldav";
export type Connection = {
  id: string;
  kind: ConnectionKind;
  experimental: boolean;
  name: string;
  color: Tone;
  enabled: boolean;
  shared: boolean;
  host: string | null;
  account: string | null;
  calendars: string[];
  contacts?: boolean;
  syncHours: number | null;
  effectiveSyncHours: number;
  lastSyncedAt: string | null;
  lastStatus: "pending" | "ok" | "error" | "reauth";
  lastError: string | null;
  eventCount: number;
  syncs: boolean;
};
export type CalendarsList = {
  connections: Connection[];
  sharedWithMe: { id: string; name: string; color: Tone; owner: string }[];
  providers: { ics: boolean; google: boolean; caldav: boolean };
  limits: { maxConnections: number; defaultSyncHours: number };
  pendingReviews: number;
};
export type ReviewItem = {
  connectionId: string;
  connectionName: string;
  uid: string;
  title: string;
  kind: "birthday" | "anniversary";
  name: string;
  date: string;
  matches: { id: string; name: string; current: string | null }[];
};
export type DavCalendar = { href: string; name: string; color: string | null };
