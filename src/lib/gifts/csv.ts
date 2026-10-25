// CSV reading, writing and column mapping for gifts, people and wishlists. Pure and shared.

export type CsvType = "gifts" | "people" | "wishlist";

/** RFC 4180 parser: quoted fields, doubled quotes, CRLF, BOM. Delimiter is detected (comma, semicolon or tab). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** One cell. Anything a spreadsheet could read as a formula gets a leading apostrophe. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type FieldSpec = {
  key: string;
  label: string;
  required: boolean;
  /** lower-case header names that map here automatically */
  aliases: string[];
  example: string;
};

export const FIELDS: Record<CsvType, FieldSpec[]> = {
  gifts: [
    { key: "direction", label: "Given or received", required: false, aliases: ["direction", "type", "kind", "given/received"], example: "given" },
    { key: "title", label: "Gift", required: true, aliases: ["title", "gift", "item", "name", "description", "what"], example: "Lego set" },
    { key: "occasion", label: "Occasion", required: false, aliases: ["occasion", "event", "holiday", "for"], example: "Birthday" },
    { key: "date", label: "Date", required: true, aliases: ["date", "when", "day"], example: "2026-12-02" },
    { key: "giver", label: "From", required: false, aliases: ["giver", "from", "given by", "gifter"], example: "Avery Cole" },
    { key: "receiver", label: "To", required: false, aliases: ["receiver", "to", "recipient", "given to", "for who"], example: "Noah Cole" },
    { key: "amount", label: "Amount", required: false, aliases: ["amount", "price", "cost", "spent", "$"], example: "39.99" },
    { key: "status", label: "Status", required: false, aliases: ["status", "state", "stage"], example: "purchased" },
    { key: "thanked", label: "Thanked", required: false, aliases: ["thanked", "thank you", "thank-you sent", "thanks"], example: "no" },
    { key: "note", label: "Note", required: false, aliases: ["note", "notes", "comment", "comments"], example: "Blue box" },
  ],
  people: [
    { key: "name", label: "Name", required: true, aliases: ["name", "person", "full name"], example: "Noah Cole" },
    { key: "relationship", label: "Relationship", required: false, aliases: ["relationship", "role", "relation"], example: "son" },
    { key: "circle", label: "Household or outside", required: false, aliases: ["circle", "group", "household"], example: "household" },
    { key: "birthday", label: "Birthday", required: false, aliases: ["birthday", "birth date", "dob", "born"], example: "2016-12-02" },
    { key: "anniversary", label: "Anniversary", required: false, aliases: ["anniversary", "wedding"], example: "" },
  ],
  wishlist: [
    { key: "person", label: "Person", required: true, aliases: ["person", "name", "for", "who", "owner"], example: "Noah Cole" },
    { key: "title", label: "Item", required: true, aliases: ["title", "item", "gift", "wish"], example: "Lego set" },
    { key: "url", label: "Link", required: false, aliases: ["url", "link", "website", "page"], example: "https://example.com/lego" },
    { key: "price", label: "Price", required: false, aliases: ["price", "cost", "amount", "$"], example: "49.99" },
    { key: "size", label: "Size", required: false, aliases: ["size"], example: "" },
    { key: "notes", label: "Notes", required: false, aliases: ["notes", "note", "comment", "comments"], example: "The big one" },
    { key: "priority", label: "Priority", required: false, aliases: ["priority", "importance", "rank"], example: "high" },
  ],
};

export function templateCsv(type: CsvType): string {
  const fields = FIELDS[type];
  return toCsv(fields.map((f) => f.key), [fields.map((f) => f.example)]);
}

/** Guess which column feeds each field from the header names. */
export function autoMap(type: CsvType, headers: string[]): Record<string, number | null> {
  const used = new Set<number>();
  const mapping: Record<string, number | null> = {};
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const field of FIELDS[type]) {
    let found = norm.findIndex((h, i) => !used.has(i) && h === field.key);
    if (found < 0) found = norm.findIndex((h, i) => !used.has(i) && field.aliases.includes(h));
    mapping[field.key] = found >= 0 ? found : null;
    if (found >= 0) used.add(found);
  }
  return mapping;
}

// ---- value cleaners (each returns undefined when the cell is blank, null when it is invalid) ----

const blank = (v: string | undefined) => v === undefined || v.trim() === "";

export function parseDateCell(value: string | undefined, today = new Date()): string | null | undefined {
  if (blank(value)) return undefined;
  const text = value!.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text))) {
    [m, d] = [Number(match[1]), Number(match[2])] as [number, number]; // US order: month first
    y = Number(match[3]);
    if (match[3]!.length === 2) y += 2000;
  } else if ((match = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(text))) {
    d = Number(match[1]);
    m = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2]!.toLowerCase()) + 1;
    y = Number(match[3]);
  } else return null;
  void today;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || y < 1900 || y > 2200 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A birthday or anniversary: a full date, or just month and day ("12-02", "Dec 2", "--12-02"). */
export function parseMonthDayCell(value: string | undefined): string | null | undefined {
  if (blank(value)) return undefined;
  const text = value!.trim();
  const full = parseDateCell(text);
  if (full) return full;
  let m = /^(?:--|)(\d{1,2})-(\d{1,2})$/.exec(text);
  let month: number | undefined;
  let day: number | undefined;
  if (m) [month, day] = [Number(m[1]), Number(m[2])];
  else if ((m = /^([A-Za-z]{3})[a-z]* (\d{1,2})$/.exec(text))) {
    month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1]!.toLowerCase()) + 1;
    day = Number(m[2]);
  } else if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(text))) [month, day] = [Number(m[1]), Number(m[2])];
  if (!month || !day || month > 12 || day > 31) return null;
  return `--${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseAmountCell(value: string | undefined): number | null | undefined {
  if (blank(value)) return undefined;
  const cleaned = value!.replace(/[^0-9.,-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  // "1,234.56" or "1234,56"
  const normalized = /,\d{2}$/.test(cleaned) && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}

export function parseBoolCell(value: string | undefined): boolean | null | undefined {
  if (blank(value)) return undefined;
  const t = value!.trim().toLowerCase();
  if (["yes", "y", "true", "1", "x", "done", "sent"].includes(t)) return true;
  if (["no", "n", "false", "0", "not yet", "pending"].includes(t)) return false;
  return null;
}

export function parseDirectionCell(value: string | undefined): "given" | "received" | null | undefined {
  if (blank(value)) return undefined;
  const t = value!.trim().toLowerCase();
  if (["given", "give", "gave", "out", "sent", "bought", "to"].includes(t)) return "given";
  if (["received", "receive", "got", "gotten", "in", "from", "gift received"].includes(t)) return "received";
  return null;
}

export function parseStatusCell(value: string | undefined): "idea" | "purchased" | "delivered" | null | undefined {
  if (blank(value)) return undefined;
  const t = value!.trim().toLowerCase();
  if (["idea", "planned", "plan", "todo", "to buy", "wishlist"].includes(t)) return "idea";
  if (["purchased", "bought", "buy", "ordered", "wrapped"].includes(t)) return "purchased";
  if (["delivered", "given", "gave", "done", "received", "complete", "completed"].includes(t)) return "delivered";
  return null;
}

export function parsePriorityCell(value: string | undefined): 1 | 2 | 3 | null | undefined {
  if (blank(value)) return undefined;
  const t = value!.trim().toLowerCase();
  if (["1", "high", "top", "must", "!!!"].includes(t)) return 1;
  if (["2", "medium", "med", "normal", "would like"].includes(t)) return 2;
  if (["3", "low", "nice", "nice to have"].includes(t)) return 3;
  return null;
}

export function parseCircleCell(value: string | undefined): "household" | "outside" | null | undefined {
  if (blank(value)) return undefined;
  const t = value!.trim().toLowerCase();
  if (["household", "home", "family", "yes", "y", "true", "1", "inside"].includes(t)) return "household";
  if (["outside", "extended", "friends", "no", "n", "false", "0", "other"].includes(t)) return "outside";
  return null;
}
