export type Circle = "household" | "outside";
export type Direction = "received" | "given";
export type GiftStatus = "idea" | "purchased" | "delivered";

export type Person = {
  id: string;
  name: string;
  role: string;
  circle: Circle;
};

export type Gift = {
  id: string;
  direction: Direction;
  title: string;
  occasion: string;
  date: string;
  giverId: string;
  receiverId: string;
  amount: number | null;
  status: GiftStatus;
  thanked: boolean;
  note: string;
};

export type Backup = {
  householdName: string;
  people: Person[];
  gifts: Gift[];
  occasions: string[];
};

export const DEFAULT_OCCASIONS = [
  "Christmas",
  "Birthday",
  "Hanukkah",
  "Wedding",
  "Baby",
  "Anniversary",
  "Graduation",
  "Housewarming",
  "Just because",
];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export const SEED_PEOPLE: Person[] = [
  { id: "p-avery", name: "Avery Cole", role: "You", circle: "household" },
  { id: "p-jordan", name: "Jordan Cole", role: "Partner", circle: "household" },
  { id: "p-noah", name: "Noah Cole", role: "Child", circle: "household" },
  { id: "p-june", name: "June Cole", role: "Child", circle: "household" },
  { id: "p-may", name: "May Ellison", role: "Aunt", circle: "outside" },
  { id: "p-priya", name: "Priya Shah", role: "Friend", circle: "outside" },
  { id: "p-eli", name: "Eli Brooks", role: "Coworker", circle: "outside" },
  { id: "p-nguyen", name: "The Nguyens", role: "Neighbors", circle: "outside" },
];

export const SEED_GIFTS: Gift[] = [
  {
    id: "g1",
    direction: "received",
    title: "Cashmere throw",
    occasion: "Christmas",
    date: "2025-12-25",
    giverId: "p-may",
    receiverId: "p-avery",
    amount: 78,
    status: "delivered",
    thanked: true,
    note: "Forest green.",
  },
  {
    id: "g2",
    direction: "received",
    title: "Record player",
    occasion: "Christmas",
    date: "2025-12-24",
    giverId: "p-jordan",
    receiverId: "p-avery",
    amount: 220,
    status: "delivered",
    thanked: true,
    note: "",
  },
  {
    id: "g3",
    direction: "received",
    title: "Wool scarf",
    occasion: "Christmas",
    date: "2025-12-25",
    giverId: "p-may",
    receiverId: "p-jordan",
    amount: 36,
    status: "delivered",
    thanked: true,
    note: "",
  },
  {
    id: "g4",
    direction: "given",
    title: "Ceramic vase",
    occasion: "Christmas",
    date: "2025-12-20",
    giverId: "p-avery",
    receiverId: "p-may",
    amount: 46,
    status: "delivered",
    thanked: false,
    note: "",
  },
  {
    id: "g5",
    direction: "given",
    title: "Board game",
    occasion: "Christmas",
    date: "2025-12-18",
    giverId: "p-jordan",
    receiverId: "p-nguyen",
    amount: 32,
    status: "delivered",
    thanked: false,
    note: "Wavelength.",
  },
  {
    id: "g6",
    direction: "received",
    title: "Weeknight cookbook",
    occasion: "Birthday",
    date: "2026-03-14",
    giverId: "p-priya",
    receiverId: "p-jordan",
    amount: 28,
    status: "delivered",
    thanked: true,
    note: "",
  },
  {
    id: "g7",
    direction: "given",
    title: "Potted olive tree",
    occasion: "Just because",
    date: "2026-02-14",
    giverId: "p-avery",
    receiverId: "p-priya",
    amount: 22,
    status: "delivered",
    thanked: false,
    note: "",
  },
  {
    id: "g8",
    direction: "received",
    title: "Watercolor set",
    occasion: "Birthday",
    date: "2026-06-12",
    giverId: "p-may",
    receiverId: "p-june",
    amount: 32,
    status: "delivered",
    thanked: false,
    note: "",
  },
  {
    id: "g9",
    direction: "received",
    title: "Running belt",
    occasion: "Birthday",
    date: "2026-08-19",
    giverId: "p-eli",
    receiverId: "p-avery",
    amount: 24,
    status: "delivered",
    thanked: false,
    note: "",
  },
  {
    id: "g10",
    direction: "given",
    title: "Headphones",
    occasion: "Birthday",
    date: "2026-10-18",
    giverId: "p-jordan",
    receiverId: "p-eli",
    amount: 89,
    status: "idea",
    thanked: false,
    note: "He mentioned the commute.",
  },
  {
    id: "g11",
    direction: "given",
    title: "Ski socks",
    occasion: "Christmas",
    date: "2026-12-24",
    giverId: "p-avery",
    receiverId: "p-noah",
    amount: 18,
    status: "idea",
    thanked: false,
    note: "",
  },
  {
    id: "g12",
    direction: "given",
    title: "Knitting kit",
    occasion: "Christmas",
    date: "2026-12-24",
    giverId: "p-avery",
    receiverId: "p-june",
    amount: 40,
    status: "purchased",
    thanked: false,
    note: "Waiting at the post office.",
  },
  {
    id: "g13",
    direction: "given",
    title: "Cast-iron skillet",
    occasion: "Christmas",
    date: "2026-12-24",
    giverId: "p-jordan",
    receiverId: "p-may",
    amount: 68,
    status: "idea",
    thanked: false,
    note: "",
  },
];

export function formatMoney(amount: number | null): string | null {
  if (amount == null || Number.isNaN(amount)) return null;
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatMonth(iso: string): string {
  const [y, m] = iso.split("-");
  const index = Number(m) - 1;
  if (!y || index < 0 || index > 11) return iso;
  return `${MONTHS[index]} ${y}`;
}

export function personName(people: Person[], id: string): string {
  return people.find((person) => person.id === id)?.name ?? "Someone";
}

export function yearsOf(gifts: Gift[]): number[] {
  const years = new Set<number>();
  for (const gift of gifts) {
    const year = Number(gift.date.slice(0, 4));
    if (year) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

export function monthSeries(gifts: Gift[], year: number) {
  return MONTH_LETTERS.map((label, index) => {
    const prefix = `${year}-${String(index + 1).padStart(2, "0")}`;
    let received = 0;
    let given = 0;
    for (const gift of gifts) {
      if (!gift.date.startsWith(prefix)) continue;
      if (gift.direction === "received") received += 1;
      else given += 1;
    }
    return { label, full: MONTHS[index] ?? label, received, given };
  });
}

export function yearStats(gifts: Gift[], year: number) {
  const prefix = `${year}-`;
  let received = 0;
  let given = 0;
  let spent = 0;
  for (const gift of gifts) {
    if (!gift.date.startsWith(prefix)) continue;
    if (gift.direction === "received") received += 1;
    else {
      given += 1;
      spent += gift.amount ?? 0;
    }
  }
  const thanks = gifts
    .filter((gift) => gift.direction === "received" && !gift.thanked)
    .sort((a, b) => b.date.localeCompare(a.date));
  const open = gifts
    .filter((gift) => gift.direction === "given" && gift.status !== "delivered")
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return { received, given, spent, thanks, open };
}

export function recentDelivered(gifts: Gift[]): Gift[] {
  return gifts
    .filter((gift) => gift.status === "delivered")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);
}

export function personCounts(gifts: Gift[], id: string) {
  let gave = 0;
  let got = 0;
  for (const gift of gifts) {
    if (gift.giverId === id) gave += 1;
    if (gift.receiverId === id) got += 1;
  }
  return { gave, got };
}

export function giftsForPerson(gifts: Gift[], id: string): Gift[] {
  return gifts
    .filter((gift) => gift.giverId === id || gift.receiverId === id)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function todayISO(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function serializeLedger(input: {
  householdName: string;
  people: Person[];
  gifts: Gift[];
  today: string;
}): string {
  const names = new Map(input.people.map((person) => [person.id, person.name]));
  const gifts = [...input.gifts]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 80)
    .map((gift) => ({
      date: gift.date,
      direction: gift.direction,
      title: gift.title.slice(0, 120),
      occasion: gift.occasion.slice(0, 60),
      from: names.get(gift.giverId) ?? "Unknown",
      to: names.get(gift.receiverId) ?? "Unknown",
      amountUSD: gift.amount,
      status: gift.status,
      thanked: gift.thanked,
      note: gift.note.slice(0, 140),
    }));
  return JSON.stringify({
    household: input.householdName.slice(0, 80),
    today: input.today,
    people: input.people.map((person) => ({
      name: person.name,
      role: person.role,
      circle: person.circle,
    })),
    gifts,
  });
}

export function isPerson(value: unknown): value is Person {
  if (!value || typeof value !== "object") return false;
  const person = value as Person;
  return (
    typeof person.id === "string" &&
    person.id.length > 0 &&
    person.id.length < 80 &&
    typeof person.name === "string" &&
    (person.circle === "household" || person.circle === "outside") &&
    typeof person.role === "string"
  );
}

export function isGift(value: unknown): value is Gift {
  if (!value || typeof value !== "object") return false;
  const gift = value as Gift;
  return (
    typeof gift.id === "string" &&
    gift.id.length > 0 &&
    (gift.direction === "received" || gift.direction === "given") &&
    typeof gift.title === "string" &&
    typeof gift.date === "string" &&
    typeof gift.giverId === "string" &&
    typeof gift.receiverId === "string" &&
    (gift.status === "idea" || gift.status === "purchased" || gift.status === "delivered") &&
    typeof gift.thanked === "boolean"
  );
}

export function parseBackup(text: string): Backup | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  return parseBackupData(data);
}

/** Validate and clean an already-parsed backup object (browser import, server import, localStorage). */
export function parseBackupData(data: unknown): Backup | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Partial<Backup>;
  if (typeof record.householdName !== "string") return null;
  if (!Array.isArray(record.people) || !Array.isArray(record.gifts)) return null;
  if (record.people.length > 200 || record.gifts.length > 2000) return null;
  if (!record.people.every(isPerson) || !record.gifts.every(isGift)) return null;
  return {
    householdName: record.householdName.slice(0, 80),
    people: record.people.map((person) => ({
      id: person.id,
      name: person.name.slice(0, 80),
      role: person.role.slice(0, 40),
      circle: person.circle,
    })),
    gifts: record.gifts.map((gift) => ({
      id: gift.id,
      direction: gift.direction,
      title: gift.title.slice(0, 120),
      occasion: typeof gift.occasion === "string" ? gift.occasion.slice(0, 60) : "",
      date: gift.date.slice(0, 10),
      giverId: gift.giverId,
      receiverId: gift.receiverId,
      amount: typeof gift.amount === "number" && Number.isFinite(gift.amount) ? gift.amount : null,
      status: gift.status,
      thanked: gift.thanked,
      note: typeof gift.note === "string" ? gift.note.slice(0, 400) : "",
    })),
    occasions: normalizeOccasions(
      (record as { occasions?: unknown }).occasions,
      record.gifts.map((gift) => ({
        occasion: typeof gift.occasion === "string" ? gift.occasion : "",
      })),
    ),
  };
}

export function statusLabel(status: GiftStatus): string {
  if (status === "idea") return "Idea";
  if (status === "purchased") return "Bought";
  return "Given";
}

export function cleanOccasionName(value: string): string {
  return value.trim().slice(0, 60);
}

export function normalizeOccasions(raw: unknown, gifts: { occasion: string }[]): string[] {
  const source = Array.isArray(raw) ? raw : DEFAULT_OCCASIONS;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (typeof item !== "string") continue;
    const name = cleanOccasionName(item);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= 40) break;
  }
  const base = names.length > 0 ? names : [...DEFAULT_OCCASIONS];
  for (const name of base) seen.add(name.toLowerCase());
  for (const gift of gifts) {
    if (base.length >= 40) break;
    const name = cleanOccasionName(gift.occasion);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    base.push(name);
  }
  return base;
}

/** Trim and clamp a person the same way for browser edits, imports, and the API. */
export function cleanPerson(person: Person): Person {
  return {
    id: person.id,
    name: person.name.trim().slice(0, 80),
    role: person.role.trim().slice(0, 40),
    circle: person.circle,
  };
}

/** Trim and clamp a gift the same way for browser edits, imports, and the API. */
export function cleanGift(gift: Gift): Gift {
  return {
    id: gift.id,
    direction: gift.direction,
    title: gift.title.slice(0, 120),
    occasion: typeof gift.occasion === "string" ? gift.occasion.slice(0, 60) : "",
    date: gift.date.slice(0, 10),
    giverId: gift.giverId,
    receiverId: gift.receiverId,
    amount: typeof gift.amount === "number" && Number.isFinite(gift.amount) ? gift.amount : null,
    status: gift.status,
    thanked: gift.thanked,
    note: typeof gift.note === "string" ? gift.note.slice(0, 400) : "",
  };
}

/** The full ledger as the server stores it and the client mirrors it. */
export type Ledger = Backup & {
  demo: boolean;
  demoDismissed: boolean;
};
