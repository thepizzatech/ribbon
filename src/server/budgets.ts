// Yearly budgets per person and per occasion. Spend is worked out in the browser from the gifts the viewer can see.
import type { Db } from "./db.ts";
import { transaction } from "./db.ts";
import { error, json, type Handler } from "./http.ts";
import { getPerson, listOccasions } from "./ledger.ts";

export type Budget = { scope: "person" | "occasion"; key: string; amount: number };

export function listBudgets(db: Db, hid: string, year: number, mePersonId: string | null): Budget[] {
  const rows = db
    .prepare("SELECT scope, key, amount FROM budgets WHERE household_id = ? AND year = ? ORDER BY scope, key")
    .all(hid, year) as Budget[];
  // What the family plans to spend on you is a surprise too.
  return rows.filter((row) => !(row.scope === "person" && mePersonId && row.key === mePersonId));
}

const thisYear = () => new Date().getFullYear();
const yearOf = (value: unknown) => {
  const n = value === undefined || value === null || value === "" ? thisYear() : Number(value);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

export const budgetsHandler: Handler = async (c) => {
  if (c.resource !== "budgets") return null;
  const { db, ctx, method, body } = c;
  if (method === "GET" && c.id === undefined) {
    const year = yearOf(c.url.searchParams.get("year"));
    if (!year) return error(400, "Pick a year between 2000 and 2100.");
    return json({ year, budgets: listBudgets(db, ctx.hid, year, ctx.me) });
  }
  if (method === "PUT" && c.id === undefined) {
    const input = (body ?? {}) as { scope?: unknown; key?: unknown; year?: unknown; amount?: unknown };
    const year = yearOf(input.year);
    if (!year) return error(400, "Pick a year between 2000 and 2100.");
    if (input.scope !== "person" && input.scope !== "occasion") return error(400, "Budgets are per person or per occasion.");
    const key = typeof input.key === "string" ? input.key : "";
    if (input.scope === "person") {
      if (!getPerson(ctx, key)) return error(404, "That person is gone.");
      if (ctx.me && key === ctx.me) return error(403, "Someone else sets your budget. That keeps it a surprise.");
    } else if (!listOccasions(ctx).includes(key)) return error(404, "That occasion is gone.");
    if (input.amount === null || input.amount === "") {
      db.prepare("DELETE FROM budgets WHERE household_id = ? AND scope = ? AND key = ? AND year = ?").run(ctx.hid, input.scope, key, year);
    } else {
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return error(400, "Budget should be a number.");
      db.prepare(
        `INSERT INTO budgets (household_id, scope, key, year, amount) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (household_id, scope, key, year) DO UPDATE SET amount = excluded.amount`,
      ).run(ctx.hid, input.scope, key, year, Math.round(amount * 100) / 100);
    }
    return json({ year, budgets: listBudgets(db, ctx.hid, year, ctx.me) });
  }
  if (method === "POST" && c.id === "copy") {
    const input = (body ?? {}) as { from?: unknown; to?: unknown };
    const from = yearOf(input.from);
    const to = yearOf(input.to);
    if (!from || !to || from === to) return error(400, "Pick two different years.");
    transaction(db, () => {
      db.prepare(
        `INSERT OR IGNORE INTO budgets (household_id, scope, key, year, amount)
         SELECT household_id, scope, key, ?, amount FROM budgets WHERE household_id = ? AND year = ?`,
      ).run(to, ctx.hid, from);
    });
    return json({ year: to, budgets: listBudgets(db, ctx.hid, to, ctx.me) });
  }
  return null;
};
