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

/** The gate registers here so any 401 sends the user back to the passcode screen. */
export function onUnauthorized(listener: Listener | null) {
  unauthorizedListener = listener;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
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

export type Session = { required: boolean; authed: boolean };
export type ImportPayload = Backup & { demo?: boolean; demoDismissed?: boolean };

export const api = {
  session: () => request<Session>("GET", "/api/session"),
  login: (passcode: string) => request<{ ok: true }>("POST", "/api/login", { passcode }),
  logout: () => request<{ ok: true }>("POST", "/api/logout", {}),
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
