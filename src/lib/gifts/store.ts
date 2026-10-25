import { create } from "zustand";
import { api } from "@/lib/gifts/api";
import { send } from "@/lib/gifts/sync";
import {
  DEFAULT_OCCASIONS,
  SEED_GIFTS,
  SEED_PEOPLE,
  cleanOccasionName,
  type Backup,
  type Direction,
  type Gift,
  type Ledger,
  type Person,
} from "@/lib/gifts/model";

export type ListFocus = "all" | "thanks" | "open";

type LedgerState = {
  householdName: string;
  people: Person[];
  gifts: Gift[];
  occasions: string[];
  demo: boolean;
  demoDismissed: boolean;
  /** True once the first copy of the ledger has arrived from the server. */
  ready: boolean;
  /** Set when the server refused a change; the screen was put back to the server's copy. */
  syncError: string | null;
  applyServer: (ledger: Ledger) => void;
  clearSyncError: () => void;
  listFocus: ListFocus;
  setListFocus: (focus: ListFocus) => void;
  dismissDemo: () => void;
  setHouseholdName: (name: string) => void;
  addOccasion: (name: string) => { ok: true } | { ok: false; reason: string };
  renameOccasion: (index: number, name: string) => { ok: true } | { ok: false; reason: string };
  removeOccasion: (index: number) => { ok: true } | { ok: false; reason: string };
  addPerson: (person: Person) => void;
  updatePerson: (id: string, patch: Partial<Omit<Person, "id">>) => void;
  removePerson: (id: string) => { ok: true } | { ok: false; reason: string };
  addGift: (gift: Gift) => void;
  updateGift: (id: string, patch: Partial<Omit<Gift, "id">>) => void;
  removeGift: (id: string) => void;
  clearLedger: () => void;
  loadSample: () => void;
  importBackup: (backup: Backup) => void;
};

function emptyLedger(): Ledger {
  return {
    householdName: "Our household",
    people: [],
    gifts: [],
    occasions: [...DEFAULT_OCCASIONS],
    demo: false,
    demoDismissed: true,
  };
}

function freshHousehold(): Ledger {
  return {
    householdName: "Our household",
    people: [{ id: crypto.randomUUID(), name: "You", role: "You", circle: "household" }],
    gifts: [],
    occasions: [...DEFAULT_OCCASIONS],
    demo: false,
    demoDismissed: true,
  };
}

function sampleLedger(): Ledger {
  return {
    householdName: "The Coles",
    people: SEED_PEOPLE,
    gifts: SEED_GIFTS,
    occasions: [...DEFAULT_OCCASIONS],
    demo: true,
    demoDismissed: false,
  };
}

// The store is the screen's copy of the server's ledger. Every action updates it at
// once (so the UI stays instant) and queues the matching API call; if the server says
// no, the gate reloads the server's copy over the top.
export const useLedger = create<LedgerState>()((set, get) => ({
  ...emptyLedger(),
  ready: false,
  syncError: null,
  applyServer: (ledger) => set({ ...ledger, ready: true }),
  clearSyncError: () => set({ syncError: null }),
  listFocus: "all",
  setListFocus: (listFocus) => set({ listFocus }),
  dismissDemo: () => {
    set({ demoDismissed: true });
    send(() => api.setHousehold({ demoDismissed: true }));
  },
  setHouseholdName: (name) => {
    const householdName = name.trim().slice(0, 80) || "Our household";
    set({ householdName });
    send(() => api.setHousehold({ householdName }));
  },
  addOccasion: (name) => {
    const next = cleanOccasionName(name);
    if (!next) return { ok: false, reason: "Name the occasion." };
    const occasions = get().occasions;
    if (occasions.some((item) => item.toLowerCase() === next.toLowerCase())) {
      return { ok: false, reason: "That occasion is already on the list." };
    }
    if (occasions.length >= 40) return { ok: false, reason: "40 occasions is the limit." };
    set({ occasions: [...occasions, next] });
    send(() => api.addOccasion(next));
    return { ok: true };
  },
  renameOccasion: (index, name) => {
    const occasions = get().occasions;
    const from = occasions[index];
    const next = cleanOccasionName(name);
    if (!from) return { ok: false, reason: "That occasion is gone." };
    if (!next) return { ok: false, reason: "Occasion needs a name." };
    if (occasions.some((item, itemIndex) => itemIndex !== index && item.toLowerCase() === next.toLowerCase())) {
      return { ok: false, reason: "That occasion is already on the list." };
    }
    if (from === next) return { ok: true };
    set({
      occasions: occasions.map((item, itemIndex) => (itemIndex === index ? next : item)),
      gifts: get().gifts.map((gift) => (gift.occasion === from ? { ...gift, occasion: next } : gift)),
    });
    send(() => api.renameOccasion(from, next));
    return { ok: true };
  },
  removeOccasion: (index) => {
    const occasions = get().occasions;
    if (occasions.length <= 1) return { ok: false, reason: "Keep at least one occasion." };
    const name = occasions[index];
    if (!name) return { ok: false, reason: "That occasion is gone." };
    if (get().gifts.some((gift) => gift.occasion === name)) {
      return { ok: false, reason: "Gifts still use this. Rename it, or change those gifts first." };
    }
    set({ occasions: occasions.filter((_, itemIndex) => itemIndex !== index) });
    send(() => api.removeOccasion(name));
    return { ok: true };
  },
  addPerson: (person) => {
    set({ people: [...get().people, person] });
    send(() => api.addPerson(person));
  },
  updatePerson: (id, patch) => {
    set({
      people: get().people.map((person) => (person.id === id ? { ...person, ...patch } : person)),
    });
    send(() => api.updatePerson(id, patch));
  },
  removePerson: (id) => {
    const { people, gifts } = get();
    if (people.length <= 1) return { ok: false, reason: "Keep at least one person in the ledger." };
    if (gifts.some((gift) => gift.giverId === id || gift.receiverId === id)) {
      return { ok: false, reason: "This person is on a gift. Change those gifts first." };
    }
    set({ people: people.filter((person) => person.id !== id) });
    send(() => api.removePerson(id));
    return { ok: true };
  },
  addGift: (gift) => {
    set({ gifts: [gift, ...get().gifts] });
    send(() => api.addGift(gift));
  },
  updateGift: (id, patch) => {
    // The sheet passes the whole gift; the server only needs the fields (never the id).
    const { id: _ignored, ...fields } = patch as Partial<Gift>;
    set({
      gifts: get().gifts.map((gift) => (gift.id === id ? { ...gift, ...fields } : gift)),
    });
    send(() => api.updateGift(id, fields));
  },
  removeGift: (id) => {
    set({ gifts: get().gifts.filter((gift) => gift.id !== id) });
    send(() => api.removeGift(id));
  },
  clearLedger: () => {
    const next = freshHousehold();
    set(next);
    send(() => api.importLedger(next));
  },
  loadSample: () => {
    const next = sampleLedger();
    set(next);
    send(() => api.importLedger(next));
  },
  importBackup: (backup) => {
    const next: Ledger = {
      householdName: backup.householdName || "Our household",
      people: backup.people,
      gifts: backup.gifts,
      occasions: backup.occasions.length > 0 ? backup.occasions : [...DEFAULT_OCCASIONS],
      demo: false,
      demoDismissed: true,
    };
    set(next);
    send(() => api.importLedger(next));
  },
}));

export function blankDirection(direction: Direction | undefined): Direction {
  return direction ?? "received";
}
