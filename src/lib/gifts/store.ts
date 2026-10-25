import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_OCCASIONS,
  SEED_GIFTS,
  SEED_PEOPLE,
  cleanOccasionName,
  type Backup,
  type Direction,
  type Gift,
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

const memoryStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function freshHousehold(): Pick<
  LedgerState,
  "householdName" | "people" | "gifts" | "occasions" | "demo" | "demoDismissed"
> {
  return {
    householdName: "Our household",
    people: [{ id: crypto.randomUUID(), name: "You", role: "You", circle: "household" }],
    gifts: [],
    occasions: [...DEFAULT_OCCASIONS],
    demo: false,
    demoDismissed: true,
  };
}

export const useLedger = create<LedgerState>()(
  persist(
    (set, get) => ({
      householdName: "The Coles",
      people: SEED_PEOPLE,
      gifts: SEED_GIFTS,
      occasions: [...DEFAULT_OCCASIONS],
      demo: true,
      demoDismissed: false,
      listFocus: "all",
      setListFocus: (listFocus) => set({ listFocus }),
      dismissDemo: () => set({ demoDismissed: true }),
      setHouseholdName: (name) => set({ householdName: name.trim().slice(0, 80) || "Our household" }),
      addOccasion: (name) => {
        const next = cleanOccasionName(name);
        if (!next) return { ok: false, reason: "Name the occasion." };
        const occasions = get().occasions;
        if (occasions.some((item) => item.toLowerCase() === next.toLowerCase())) {
          return { ok: false, reason: "That occasion is already on the list." };
        }
        if (occasions.length >= 40) return { ok: false, reason: "40 occasions is the limit." };
        set({ occasions: [...occasions, next] });
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
        return { ok: true };
      },
      addPerson: (person) => set({ people: [...get().people, person] }),
      updatePerson: (id, patch) =>
        set({
          people: get().people.map((person) => (person.id === id ? { ...person, ...patch } : person)),
        }),
      removePerson: (id) => {
        const { people, gifts } = get();
        if (people.length <= 1) return { ok: false, reason: "Keep at least one person in the ledger." };
        if (gifts.some((gift) => gift.giverId === id || gift.receiverId === id)) {
          return { ok: false, reason: "This person is on a gift. Change those gifts first." };
        }
        set({ people: people.filter((person) => person.id !== id) });
        return { ok: true };
      },
      addGift: (gift) => set({ gifts: [gift, ...get().gifts] }),
      updateGift: (id, patch) =>
        set({
          gifts: get().gifts.map((gift) => (gift.id === id ? { ...gift, ...patch } : gift)),
        }),
      removeGift: (id) => set({ gifts: get().gifts.filter((gift) => gift.id !== id) }),
      clearLedger: () => set(freshHousehold()),
      loadSample: () =>
        set({
          householdName: "The Coles",
          people: SEED_PEOPLE,
          gifts: SEED_GIFTS,
          occasions: [...DEFAULT_OCCASIONS],
          demo: true,
          demoDismissed: false,
        }),
      importBackup: (backup) =>
        set({
          householdName: backup.householdName || "Our household",
          people: backup.people,
          gifts: backup.gifts,
          occasions: backup.occasions.length > 0 ? backup.occasions : [...DEFAULT_OCCASIONS],
          demo: false,
          demoDismissed: true,
        }),
    }),
    {
      name: "ribbon-ledger-v1",
      skipHydration: true,
      storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage : localStorage)),
      partialize: (state) => ({
        householdName: state.householdName,
        people: state.people,
        gifts: state.gifts,
        occasions: state.occasions,
        demo: state.demo,
        demoDismissed: state.demoDismissed,
      }),
    },
  ),
);

export function blankDirection(direction: Direction | undefined): Direction {
  return direction ?? "received";
}
