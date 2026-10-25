// Browser-side calls to the Ribbon JSON API (see src/server/api.ts).
import type { Backup, Gift, Ledger, Person } from "@/lib/gifts/model";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Listener = () => void;
let unauthorizedListener: Listener | null = null;

/** The gate registers here so any 401 sends the user back to the sign-in screen. */
export function onUnauthorized(listener: Listener | null) {
  unauthorizedListener = listener;
}

// The CSRF token for the signed-in session. It arrives with /api/session, /api/login and
// /api/setup, and goes back on every write as X-CSRF-Token.
let csrfToken = "";
export const setCsrfToken = (token: string | null | undefined) => {
  csrfToken = token ?? "";
};
export const getCsrfToken = () => csrfToken;

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server.");
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!response.ok) {
    if (response.status === 401) unauthorizedListener?.();
    const message = (data as { error?: string } | null)?.error ?? `The server answered ${response.status}.`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

const enc = encodeURIComponent;

export type Role = "owner" | "member";
export type AccountUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt?: string;
  householdId?: string;
  /** The person in the ledger who is this login ("this is me"). */
  personId?: string | null;
  email?: string | null;
};
export type TourInfo = { state: "done" | "skipped" | null; at: string | null; autoShow: boolean };
export type SsoInfo = { enabled: boolean; label?: string; passwordDisabled?: boolean; linked?: boolean };
export type Session = {
  version: string;
  commit: string | null;
  setupRequired: boolean;
  /** A ledger already exists (an upgrade from before accounts): setup only creates the owner login. */
  hasLedger: boolean;
  householdName: string | null;
  setupCodeRequired: boolean;
  /** Why the first owner can't be created from this connection (no SETUP_CODE and not on the home network), or null. */
  setupBlocked: string | null;
  /** The connection looks like HTTPS to the server (directly or through a trusted proxy). */
  secure: boolean;
  /** Set when password sign-in is refused from this connection (plain HTTP from outside the home network). */
  insecureLoginBlocked: string | null;
  privateNetwork: boolean;
  sampleData: boolean;
  authed: boolean;
  user: AccountUser | null;
  csrfToken: string | null;
  household?: { id: string; name: string } | null;
  /** The signed-in owner still has to finish the Welcome setup (the server keeps everything else closed). */
  welcomeRequired?: boolean;
  sso?: SsoInfo;
  passkeys?: number;
  isAdmin?: boolean;
  tour?: TourInfo | null;
};
export type SetupInput = {
  setupCode?: string;
  familyName?: string;
  yourName?: string;
  people?: { name: string; relationship: string; role?: string; household: boolean }[];
  username: string;
  password: string;
};
export type WelcomeMember = { name: string; relationship: string; role?: string; household: boolean };
export type WelcomeState = { required: true; familyName: string; yourName: string; step: 1 | 2; members: WelcomeMember[] };
export type WelcomeInput = { familyName?: string; yourName?: string; members?: WelcomeMember[]; step?: 1 | 2 };
export type ImportPayload = Backup & { demo?: boolean; demoDismissed?: boolean };

export const api = {
  session: async () => {
    const session = await request<Session>("GET", "/api/session");
    setCsrfToken(session.csrfToken);
    return session;
  },
  setup: async (input: SetupInput) => {
    const session = await request<Session>("POST", "/api/setup", input);
    setCsrfToken(session.csrfToken);
    return session;
  },
  login: async (username: string, password: string) => {
    const session = await request<Session>("POST", "/api/login", { username, password });
    setCsrfToken(session.csrfToken);
    return session;
  },
  logout: async () => {
    const result = await request<{ ok: true }>("POST", "/api/logout", {});
    setCsrfToken(null);
    return result;
  },
  welcome: () => request<WelcomeState>("GET", "/api/welcome"),
  saveWelcome: (input: WelcomeInput) => request<WelcomeState>("PUT", "/api/welcome", input),
  finishWelcome: (input: WelcomeInput) => request<{ ok: true }>("POST", "/api/welcome/complete", input),
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>("POST", "/api/account/password", { current, next }),
  users: () => request<{ users: AccountUser[] }>("GET", "/api/users"),
  addUser: (input: { username: string; password?: string; displayName?: string; role: Role; email?: string; personId?: string }) =>
    request<{ user: AccountUser }>("POST", "/api/users", input),
  updateUser: (id: string, patch: { personId?: string | null; role?: Role; displayName?: string }) =>
    request<{ user: AccountUser }>("PATCH", `/api/users/${enc(id)}`, patch),
  removeUser: (id: string) => request<{ ok: true }>("DELETE", `/api/users/${enc(id)}`),
  ledger: () => request<Ledger>("GET", "/api/ledger"),
  setHousehold: (patch: { householdName?: string; demo?: boolean; demoDismissed?: boolean }) =>
    request<Ledger>("PUT", "/api/household", patch),
  addPerson: (person: Person) => request("POST", "/api/people", person),
  updatePerson: (id: string, patch: Partial<Omit<Person, "id">>) => request("PATCH", `/api/people/${enc(id)}`, patch),
  removePerson: (id: string) => request("DELETE", `/api/people/${enc(id)}`),
  addGift: (gift: Gift) => request("POST", "/api/gifts", gift),
  updateGift: (id: string, patch: Partial<Omit<Gift, "id">>) => request("PATCH", `/api/gifts/${enc(id)}`, patch),
  removeGift: (id: string) => request("DELETE", `/api/gifts/${enc(id)}`),
  addOccasion: (name: string) => request("POST", "/api/occasions", { name }),
  renameOccasion: (from: string, name: string) => request("PATCH", `/api/occasions/${enc(from)}`, { name }),
  setOccasionDate: (name: string, date: string | null) => request("PATCH", `/api/occasions/${enc(name)}`, { date }),
  removeOccasion: (name: string) => request("DELETE", `/api/occasions/${enc(name)}`),
  importLedger: (payload: ImportPayload) => request<Ledger>("POST", "/api/import", payload),
};
