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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
export type AccountUser = { id: string; username: string; displayName: string; role: Role; createdAt?: string };
export type Session = {
  version: string;
  commit: string | null;
  setupRequired: boolean;
  /** A ledger already exists (an upgrade from before accounts): setup only creates the owner login. */
  hasLedger: boolean;
  householdName: string | null;
  setupCodeRequired: boolean;
  /** The connection looks like HTTPS to the server (directly or through a trusted proxy). */
  secure: boolean;
  /** Set when password sign-in is refused from this connection (plain HTTP from outside the home network). */
  insecureLoginBlocked: string | null;
  privateNetwork: boolean;
  sampleData: boolean;
  authed: boolean;
  user: AccountUser | null;
  csrfToken: string | null;
};
export type SetupInput = {
  setupCode?: string;
  familyName?: string;
  yourName?: string;
  people?: { name: string; relationship: string; role?: string; household: boolean }[];
  username: string;
  password: string;
};
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
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>("POST", "/api/account/password", { current, next }),
  users: () => request<{ users: AccountUser[] }>("GET", "/api/users"),
  addUser: (input: { username: string; password: string; displayName?: string; role: Role }) =>
    request<{ user: AccountUser }>("POST", "/api/users", input),
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
  removeOccasion: (name: string) => request("DELETE", `/api/occasions/${enc(name)}`),
  importLedger: (payload: ImportPayload) => request<Ledger>("POST", "/api/import", payload),
};
