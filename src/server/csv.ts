// CSV export, template, and a two-step import (preview with column mapping, then apply).
import { randomUUID } from "node:crypto";
import { transaction } from "./db.ts";
import { error, json, type Handler } from "./http.ts";
import { addGift, addOccasion, addPerson, getLedger, listOccasions, listPeople, type Ctx } from "./ledger.ts";
import {
  FIELDS,
  autoMap,
  parseAmountCell,
  parseBoolCell,
  parseCircleCell,
  parseCsv,
  parseDateCell,
  parseDirectionCell,
  parseMonthDayCell,
  parsePriorityCell,
  parseStatusCell,
  templateCsv,
  toCsv,
  type CsvType,
} from "../lib/gifts/csv.ts";
import { normalizeRelationship, relationshipLabel, type Person } from "../lib/gifts/model.ts";
import { listWishlist } from "./wishlist.ts";
import type { User } from "./users.ts";

const MAX_ROWS = 5000;
const isType = (value: unknown): value is CsvType => value === "gifts" || value === "people" || value === "wishlist";

export function exportCsv(ctx: Ctx, viewer: User, type: CsvType): string {
  const ledger = getLedger(ctx);
  const name = (id: string) => ledger.people.find((p) => p.id === id)?.name ?? "";
  if (type === "people") {
    return toCsv(
      FIELDS.people.map((f) => f.key),
      ledger.people.map((p) => [p.name, p.relationship, p.circle, p.birthday ?? "", p.anniversary ?? ""]),
    );
  }
  if (type === "gifts") {
    return toCsv(
      FIELDS.gifts.map((f) => f.key),
      ledger.gifts.map((g) => [g.direction, g.title, g.occasion, g.date, name(g.giverId), name(g.receiverId), g.amount ?? "", g.status, g.thanked ? "yes" : "no", g.note]),
    );
  }
  return toCsv(
    FIELDS.wishlist.map((f) => f.key),
    listWishlist(ctx, viewer).map((i) => [name(i.personId), i.title, i.url, i.price ?? "", i.size, i.notes, i.priority === 1 ? "high" : i.priority === 3 ? "low" : "medium"]),
  );
}

export type PreviewRow = { line: number; ok: boolean; duplicate: boolean; errors: string[]; values: Record<string, string | number | boolean | null> };
export type Analysis = {
  headers: string[];
  mapping: Record<string, number | null>;
  rows: PreviewRow[];
  newPeople: string[];
  /** Problems with the file or the mapping as a whole. */
  problems: string[];
};

type Lookup = { byFull: Map<string, Person>; byFirst: Map<string, Person[]> };
const lookup = (people: Person[]): Lookup => {
  const byFull = new Map<string, Person>();
  const byFirst = new Map<string, Person[]>();
  for (const p of people) {
    byFull.set(p.name.trim().toLowerCase(), p);
    const first = p.name.trim().split(/\s+/)[0]!.toLowerCase();
    byFirst.set(first, [...(byFirst.get(first) ?? []), p]);
  }
  return { byFull, byFirst };
};
const resolve = (l: Lookup, value: string): Person | undefined => {
  const key = value.trim().toLowerCase();
  return l.byFull.get(key) ?? (l.byFirst.get(key)?.length === 1 ? l.byFirst.get(key)![0] : undefined);
};

export function analyze(ctx: Ctx, type: CsvType, text: string, wantedMapping?: Record<string, number | null>): Analysis {
  const table = parseCsv(text);
  const headers = table[0] ?? [];
  const problems: string[] = [];
  if (table.length === 0) problems.push("The file is empty.");
  if (table.length - 1 > MAX_ROWS) problems.push(`That’s more than ${MAX_ROWS} rows. Split the file and import in parts.`);
  const mapping = { ...autoMap(type, headers), ...(wantedMapping ?? {}) };
  for (const field of FIELDS[type]) {
    const idx = mapping[field.key];
    if (idx !== null && idx !== undefined && (!Number.isInteger(idx) || idx < 0 || idx >= headers.length)) mapping[field.key] = null;
    if (field.required && (mapping[field.key] === null || mapping[field.key] === undefined)) problems.push(`Choose a column for “${field.label}”.`);
  }
  const people = listPeople(ctx);
  const l = lookup(people);
  const myself = (ctx.me && people.find((p) => p.id === ctx.me)) || people.find((p) => p.relationship === "self") || people[0];
  const newPeople = new Set<string>();
  const existing = new Set<string>();
  if (type === "gifts") for (const g of getLedger(ctx).gifts) existing.add(`${g.title}|${g.date}|${g.giverId}|${g.receiverId}`.toLowerCase());
  if (type === "people") for (const p of people) existing.add(p.name.toLowerCase());
  if (type === "wishlist") {
    const items = ctx.db.prepare("SELECT person_id, title FROM wishlist_items WHERE household_id = ?").all(ctx.hid) as { person_id: string; title: string }[];
    for (const i of items) existing.add(`${i.person_id}|${i.title}`.toLowerCase());
  }
  const rows: PreviewRow[] = [];
  const seen = new Set<string>();
  if (problems.length === 0 || (table.length > 1 && !problems.some((p) => p.startsWith("The file")))) {
    for (let r = 1; r < Math.min(table.length, MAX_ROWS + 1); r += 1) {
      const cells = table[r]!;
      const get = (key: string) => {
        const idx = mapping[key];
        return idx === null || idx === undefined ? undefined : cells[idx];
      };
      const errors: string[] = [];
      const values: PreviewRow["values"] = {};
      const text = (key: string, max: number) => {
        const v = get(key)?.trim();
        return v ? v.slice(0, max) : "";
      };
      let dupKey = "";
      if (type === "people") {
        const name = text("name", 80);
        if (!name) errors.push("Name is blank.");
        const birthday = parseMonthDayCell(get("birthday"));
        const anniversary = parseMonthDayCell(get("anniversary"));
        const circle = parseCircleCell(get("circle"));
        if (birthday === null) errors.push("Birthday isn’t a date (try 2016-12-02 or Dec 2).");
        if (anniversary === null) errors.push("Anniversary isn’t a date.");
        if (circle === null) errors.push("Circle should be household or outside.");
        const relRaw = text("relationship", 40);
        const relationship = normalizeRelationship(relRaw.toLowerCase(), relRaw);
        Object.assign(values, { name, relationship, circle: circle ?? "outside", birthday: birthday ?? null, anniversary: anniversary ?? null });
        dupKey = name.toLowerCase();
      } else if (type === "wishlist") {
        const who = text("person", 80);
        const title = text("title", 120);
        const found = who ? resolve(l, who) : undefined;
        if (!who) errors.push("Person is blank.");
        else if (!found) errors.push(`No one called “${who}”.`);
        if (!title) errors.push("Item is blank.");
        const price = parseAmountCell(get("price"));
        if (price === null) errors.push("Price isn’t a number.");
        const priority = parsePriorityCell(get("priority"));
        if (priority === null) errors.push("Priority should be high, medium or low.");
        const url = text("url", 500);
        if (url && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(url)) errors.push("Link doesn’t look like a web address.");
        Object.assign(values, { person: found?.name ?? who, personId: found?.id ?? null, title, url, price: price ?? null, size: text("size", 40), notes: text("notes", 400), priority: priority ?? 2 });
        dupKey = `${found?.id}|${title}`.toLowerCase();
      } else {
        const title = text("title", 120);
        if (!title) errors.push("Gift is blank.");
        const date = parseDateCell(get("date"));
        if (date === undefined) errors.push("Date is blank.");
        else if (date === null) errors.push("Date isn’t readable (use 2026-12-02 or 12/2/2026).");
        const direction = parseDirectionCell(get("direction"));
        if (direction === null) errors.push("Direction should be given or received.");
        const dir = direction ?? "given";
        const status = parseStatusCell(get("status"));
        if (status === null) errors.push("Status should be idea, purchased or delivered.");
        const amount = parseAmountCell(get("amount"));
        if (amount === null) errors.push("Amount isn’t a number.");
        const thanked = parseBoolCell(get("thanked"));
        if (thanked === null) errors.push("Thanked should be yes or no.");
        const giverRaw = text("giver", 80);
        const receiverRaw = text("receiver", 80);
        const resolveOrNew = (raw: string, label: string, fallback: Person | undefined) => {
          if (!raw) {
            if (!fallback) errors.push(`${label} is blank.`);
            return fallback;
          }
          const found = resolve(l, raw);
          if (found) return found;
          newPeople.add(raw);
          return { id: `new:${raw.toLowerCase()}`, name: raw } as Person;
        };
        const giver = resolveOrNew(giverRaw, "From", dir === "given" ? myself : undefined);
        const receiver = resolveOrNew(receiverRaw, "To", dir === "received" ? myself : undefined);
        const occasion = text("occasion", 60) || "Other";
        Object.assign(values, {
          direction: dir, title, occasion, date: date ?? null, giver: giver?.name ?? "", giverId: giver?.id ?? null,
          receiver: receiver?.name ?? "", receiverId: receiver?.id ?? null, amount: amount ?? null,
          status: status ?? "delivered", thanked: thanked ?? false, note: text("note", 400),
        });
        dupKey = `${title}|${date}|${giver?.id}|${receiver?.id}`.toLowerCase();
      }
      const duplicate = errors.length === 0 && (existing.has(dupKey) || seen.has(dupKey));
      if (errors.length === 0) seen.add(dupKey);
      rows.push({ line: r + 1, ok: errors.length === 0, duplicate, errors, values });
    }
  }
  return { headers, mapping, rows, newPeople: [...newPeople], problems };
}

export type ImportResult = { added: number; duplicates: number; invalid: number; newPeople: string[]; failed: { line: number; reason: string }[] };

export function applyImport(ctx: Ctx, viewer: User, type: CsvType, analysis: Analysis, createPeople: boolean): ImportResult {
  const result: ImportResult = { added: 0, duplicates: 0, invalid: 0, newPeople: [], failed: [] };
  transaction(ctx.db, () => {
    const made = new Map<string, string>(); // lowercase name -> id
    const ensurePerson = (name: string): string | null => {
      const key = name.toLowerCase();
      if (made.has(key)) return made.get(key)!;
      if (!createPeople) return null;
      const added = addPerson(ctx, { name, role: "Other", circle: "outside", relationship: "other" });
      if (!added.ok) return null;
      made.set(key, added.person.id);
      result.newPeople.push(name);
      return added.person.id;
    };
    const idFor = (id: unknown, name: unknown): string | null => {
      if (typeof id === "string" && !id.startsWith("new:")) return id;
      return typeof name === "string" && name ? ensurePerson(name) : null;
    };
    for (const row of analysis.rows) {
      if (!row.ok) {
        result.invalid += 1;
        continue;
      }
      if (row.duplicate) {
        result.duplicates += 1;
        continue;
      }
      const v = row.values;
      if (type === "people") {
        const added = addPerson(ctx, {
          name: v.name, role: relationshipLabel(String(v.relationship)), relationship: v.relationship, circle: v.circle,
          birthday: v.birthday, anniversary: v.anniversary,
        });
        if (added.ok) result.added += 1;
        else result.failed.push({ line: row.line, reason: added.reason });
      } else if (type === "wishlist") {
        const now = new Date().toISOString();
        const seq = (ctx.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM wishlist_items").get() as { n: number }).n;
        ctx.db
          .prepare(
            `INSERT INTO wishlist_items (id, household_id, person_id, seq, title, url, price, size, notes, priority, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), ctx.hid, v.personId as string, seq, v.title as string, /^https?:\/\//i.test(String(v.url)) || !v.url ? String(v.url) : `https://${v.url}`, v.price as number | null, v.size as string, v.notes as string, v.priority as number, now, now);
        result.added += 1;
      } else {
        const giverId = idFor(v.giverId, v.giver);
        const receiverId = idFor(v.receiverId, v.receiver);
        if (!giverId || !receiverId) {
          result.failed.push({ line: row.line, reason: "Someone in this row isn’t in your household yet (turn on “add new people”)." });
          continue;
        }
        if (!listOccasions(ctx).some((o) => o.toLowerCase() === String(v.occasion).toLowerCase())) addOccasion(ctx, { name: v.occasion });
        const occasion = listOccasions(ctx).find((o) => o.toLowerCase() === String(v.occasion).toLowerCase()) ?? String(v.occasion);
        const added = addGift(ctx, {
          direction: v.direction, title: v.title, occasion, date: v.date, giverId, receiverId, amount: v.amount, status: v.status,
          thanked: v.direction === "received" ? v.thanked : false, note: v.note,
        });
        if (added.ok) result.added += 1;
        else result.failed.push({ line: row.line, reason: added.reason });
      }
    }
  });
  void viewer;
  return result;
}

const csvResponse = (text: string, name: string) =>
  new Response("\uFEFF" + text, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });

export const csvHandler: Handler = async (c) => {
  if (c.resource !== "csv") return null;
  const type = c.method === "GET" ? c.url.searchParams.get("type") : (c.body as { type?: unknown } | null)?.type;
  if (!isType(type)) return error(400, "Choose gifts, people or wishlist.");
  if (c.method === "GET" && c.id === "export") return csvResponse(exportCsv(c.ctx, c.session.user, type), `ribbon-${type}.csv`);
  if (c.method === "GET" && c.id === "template") return csvResponse(templateCsv(type), `ribbon-${type}-template.csv`);
  if (c.method === "POST" && (c.id === "preview" || c.id === "import")) {
    const body = c.body as { text?: unknown; mapping?: unknown; createPeople?: unknown };
    if (typeof body.text !== "string") return error(400, "Send the file’s text.");
    const mapping = body.mapping && typeof body.mapping === "object" ? (body.mapping as Record<string, number | null>) : undefined;
    const analysis = analyze(c.ctx, type, body.text, mapping);
    if (c.id === "preview") {
      return json({
        type,
        fields: FIELDS[type],
        headers: analysis.headers,
        mapping: analysis.mapping,
        problems: analysis.problems,
        newPeople: analysis.newPeople,
        counts: {
          total: analysis.rows.length,
          valid: analysis.rows.filter((r) => r.ok && !r.duplicate).length,
          invalid: analysis.rows.filter((r) => !r.ok).length,
          duplicates: analysis.rows.filter((r) => r.duplicate).length,
        },
        // enough to review; the import re-reads the whole file
        rows: [...analysis.rows.filter((r) => !r.ok), ...analysis.rows.filter((r) => r.ok)].slice(0, 100).sort((a, b) => a.line - b.line),
      });
    }
    if (analysis.problems.length > 0) return error(400, analysis.problems[0]!);
    return json(applyImport(c.ctx, c.session.user, type, analysis, body.createPeople === true));
  }
  return null;
};
