// Browser-side calls for wishlists, budgets, calendar, backups, CSV, sharing, Secret Santa, passkeys and the tour.
import { getCsrfToken, request } from "@/lib/gifts/api";
import type { Gift, Ledger } from "@/lib/gifts/model";

const enc = encodeURIComponent;

export type WishStatus = "wanted" | "reserved" | "purchased";
export type WishItem = {
  id: string;
  personId: string;
  title: string;
  url: string;
  price: number | null;
  size: string;
  notes: string;
  priority: 1 | 2 | 3;
  status: WishStatus;
  claimedBy: string | null;
  claimedByMe: boolean;
  createdAt: string;
};
export type WishInput = Partial<Pick<WishItem, "title" | "url" | "price" | "size" | "notes" | "priority">> & { personId?: string };
export type SharedList = {
  household: { id: string; name: string };
  person: { id: string; name: string; relationship: string; role: string };
  items: WishItem[];
};
export type Budget = { scope: "person" | "occasion"; key: string; amount: number };
export type CalendarInfo = { token: string | null; remindDays: number };
export type BackupFile = { name: string; kind: "auto" | "manual" | "pre-restore"; size: number; createdAt: string };
export type BackupSchedule = { cron: string; valid: boolean; enabled: boolean; keep: number; next: string | null; directory: string; count: number };
export type CsvType = "gifts" | "people" | "wishlist";
export type CsvField = { key: string; label: string; required: boolean; aliases: string[]; example: string };
export type CsvPreview = {
  type: CsvType;
  fields: CsvField[];
  headers: string[];
  mapping: Record<string, number | null>;
  problems: string[];
  newPeople: string[];
  counts: { total: number; valid: number; invalid: number; duplicates: number };
  rows: { line: number; ok: boolean; duplicate: boolean; errors: string[]; values: Record<string, string | number | boolean | null> }[];
};
export type CsvResult = { added: number; duplicates: number; invalid: number; newPeople: string[]; failed: { line: number; reason: string }[] };
export type SharingSummary = { household: { id: string; name: string }; links: { id: string; name: string }[]; sharedPeople: number };
export type PersonInfo = { personId: string; name: string; householdId: string; householdName: string; hasLogin: boolean };
export type Exchange = {
  id: string;
  name: string;
  date: string;
  budget: number | null;
  status: "draft" | "drawn";
  drawCount: number;
  drawnAt: string | null;
  organiser: { name: string; householdName: string; isMe: boolean };
  canManage: boolean;
  organiserPeek?: boolean;
  avoidPrevious?: boolean;
  youAreIn: boolean;
  participants: (PersonInfo & { isMe: boolean })[];
  mine: PersonInfo | null;
  exclusions?: { giverId: string; receiverId: string }[];
  assignments?: { giver: string; receiver: string }[];
};
export type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

async function raw(method: string, path: string, body: BodyInit | undefined, headers: Record<string, string> = {}): Promise<Response> {
  const h: Record<string, string> = { ...headers };
  if (method !== "GET" && getCsrfToken()) h["x-csrf-token"] = getCsrfToken();
  return fetch(path, { method, body, headers: h, credentials: "same-origin" });
}

export const xapi = {
  wishlist: (personId?: string) => request<{ items: WishItem[] }>("GET", `/api/wishlist${personId ? `?personId=${enc(personId)}` : ""}`),
  addWish: (input: WishInput) => request<{ item: WishItem }>("POST", "/api/wishlist", input),
  updateWish: (id: string, patch: WishInput & { status?: WishStatus }) => request<{ item: WishItem }>("PATCH", `/api/wishlist/${enc(id)}`, patch),
  removeWish: (id: string) => request("DELETE", `/api/wishlist/${enc(id)}`),
  convertWish: (id: string, input: { occasion?: string; date?: string } = {}) => request<{ gift: Gift; item: WishItem }>("POST", `/api/wishlist/${enc(id)}/convert`, input),
  sharedLists: () => request<{ lists: SharedList[] }>("GET", "/api/shared/wishlists"),
  claimShared: (id: string, status: WishStatus) => request<{ item: WishItem }>("PATCH", `/api/shared/wishlist/${enc(id)}`, { status }),

  budgets: (year: number) => request<{ year: number; budgets: Budget[] }>("GET", `/api/budgets?year=${year}`),
  setBudget: (input: { scope: "person" | "occasion"; key: string; year: number; amount: number | null }) =>
    request<{ year: number; budgets: Budget[] }>("PUT", "/api/budgets", input),
  copyBudgets: (from: number, to: number) => request<{ year: number; budgets: Budget[] }>("POST", "/api/budgets/copy", { from, to }),

  calendar: () => request<CalendarInfo>("GET", "/api/calendar"),
  newCalendarToken: () => request<CalendarInfo>("POST", "/api/calendar/token", {}),
  removeCalendarToken: () => request<CalendarInfo>("DELETE", "/api/calendar/token"),
  setRemindDays: (remindDays: number) => request<CalendarInfo>("PATCH", "/api/calendar", { remindDays }),

  backups: () => request<{ backups: BackupFile[]; schedule: BackupSchedule }>("GET", "/api/backups"),
  makeBackup: () => request<{ backup: BackupFile; backups: BackupFile[] }>("POST", "/api/backups", {}),
  deleteBackup: (name: string) => request<{ backups: BackupFile[] }>("DELETE", `/api/backups/${enc(name)}`),
  restoreBackup: (name: string) => request<{ ok: true; safetyBackup: string; signedOut: boolean }>("POST", `/api/backups/${enc(name)}/restore`, { confirm: "restore" }),
  restoreUpload: async (file: File) => {
    const response = await raw("POST", "/api/backups/restore-upload", file, { "content-type": "application/octet-stream", "x-confirm": "restore" });
    const data = (await response.json().catch(() => null)) as { error?: string; safetyBackup?: string; signedOut?: boolean } | null;
    if (!response.ok) throw new Error(data?.error ?? `The server answered ${response.status}.`);
    return data as { ok: true; safetyBackup: string; signedOut: boolean };
  },
  backupUrl: (name: string) => `/api/backups/${enc(name)}/download`,

  csvPreview: (type: CsvType, text: string, mapping?: Record<string, number | null>) => request<CsvPreview>("POST", "/api/csv/preview", { type, text, mapping }),
  csvImport: (type: CsvType, text: string, mapping: Record<string, number | null>, createPeople: boolean) =>
    request<CsvResult>("POST", "/api/csv/import", { type, text, mapping, createPeople }),
  csvUrl: (kind: "export" | "template", type: CsvType) => `/api/csv/${kind}?type=${type}`,

  households: () => request<{ households: { id: string; name: string; logins: number; owner: string; mine: boolean }[] }>("GET", "/api/households"),
  addHousehold: (input: { familyName: string; yourName: string; username: string; password: string }) =>
    request<{ household: { id: string; name: string } }>("POST", "/api/households", input),
  sharing: () => request<SharingSummary>("GET", "/api/sharing"),
  invite: () => request<{ code: string; expiresAt: number }>("POST", "/api/sharing/invite", {}),
  join: (code: string) => request<SharingSummary>("POST", "/api/sharing/join", { code }),
  unlink: (id: string) => request<SharingSummary>("DELETE", `/api/sharing/links/${enc(id)}`),

  exchanges: () => request<{ exchanges: Exchange[] }>("GET", "/api/exchanges"),
  candidates: () => request<{ people: PersonInfo[] }>("GET", "/api/exchanges/candidates"),
  createExchange: (input: { name: string; date: string; budget?: number | null; organiserPeek?: boolean; avoidPrevious?: boolean }) =>
    request<{ exchange: Exchange }>("POST", "/api/exchanges", input),
  updateExchange: (id: string, patch: Record<string, unknown>) => request<{ exchange: Exchange }>("PATCH", `/api/exchanges/${enc(id)}`, patch),
  deleteExchange: (id: string) => request("DELETE", `/api/exchanges/${enc(id)}`),
  setParticipants: (id: string, personIds: string[], confirm = false) =>
    request<{ exchange: Exchange }>("PUT", `/api/exchanges/${enc(id)}/participants`, { personIds, confirm }),
  setExclusions: (id: string, pairs: [string, string][], confirm = false) =>
    request<{ exchange: Exchange }>("PUT", `/api/exchanges/${enc(id)}/exclusions`, { pairs, confirm }),
  checkExchange: (id: string) =>
    request<{ ok: boolean; detail?: string; stuck?: string[] }>("POST", `/api/exchanges/${enc(id)}/check`, {}),
  drawExchange: (id: string, confirm = false) => request<{ exchange: Exchange }>("POST", `/api/exchanges/${enc(id)}/draw`, { confirm }),

  passkeys: () => request<{ passkeys: Passkey[] }>("GET", "/api/me/passkeys"),
  passkeyOptions: () => request<{ options: unknown; challengeId: string }>("POST", "/api/me/passkeys/options", {}),
  addPasskey: (challengeId: string, response: unknown, name: string) => request<{ passkeys: Passkey[] }>("POST", "/api/me/passkeys", { challengeId, response, name }),
  removePasskey: (id: string) => request<{ passkeys: Passkey[] }>("DELETE", `/api/me/passkeys/${enc(id)}`),
  passkeyLoginOptions: () => request<{ options: unknown; challengeId: string }>("GET", "/api/auth/passkey/options"),
  passkeyLogin: (challengeId: string, response: unknown) => request<import("@/lib/gifts/api").Session>("POST", "/api/auth/passkey/login", { challengeId, response }),
  unlinkSso: () => request("DELETE", "/api/me/sso"),

  setMyPerson: (personId: string) => request("PUT", "/api/me/person", { personId }),
  setTour: (state: "done" | "skipped" | "reset") => request<{ tour: import("@/lib/gifts/api").TourInfo }>("POST", "/api/me/tour", { state }),
  ledger: () => request<Ledger>("GET", "/api/ledger"),
};
