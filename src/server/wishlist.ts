// Per-person wishlists with surprise-safe reserve/purchase marks, and one-tap conversion to a gift.
import { randomUUID } from "node:crypto";
import { transaction, type Db } from "./db.ts";
import { error, json, type ApiCall, type Handler } from "./http.ts";
import { addGift, getPerson, householdRow, listOccasions, listPeople, type Ctx } from "./ledger.ts";
import { areLinked, linkedHouseholdIds } from "./sharing.ts";
import type { User } from "./users.ts";

export type WishStatus = "wanted" | "reserved" | "purchased";
export type WishItem = {
  id: string;
  personId: string;
  title: string;
  url: string;
  price: number | null;
  size: string;
  notes: string;
  /** 1 = really want, 2 = would like, 3 = nice to have */
  priority: 1 | 2 | 3;
  status: WishStatus;
  /** Who reserved or bought it. Hidden from the person whose list it is. */
  claimedBy: string | null;
  claimedByMe: boolean;
  createdAt: string;
};

type Row = {
  id: string;
  household_id: string;
  person_id: string;
  title: string;
  url: string;
  price: number | null;
  size: string;
  notes: string;
  priority: 1 | 2 | 3;
  status: WishStatus;
  claimed_by_user_id: string | null;
  claimed_by_name: string;
  created_at: string;
};

const COLS = "id, household_id, person_id, title, url, price, size, notes, priority, status, claimed_by_user_id, claimed_by_name, created_at";

/** Shape an item for a viewer. On their own list, reserved/purchased marks are hidden from them. */
export function viewItem(row: Row, viewer: Pick<User, "id" | "personId">): WishItem {
  const own = Boolean(viewer.personId) && viewer.personId === row.person_id;
  return {
    id: row.id,
    personId: row.person_id,
    title: row.title,
    url: row.url,
    price: row.price,
    size: row.size,
    notes: row.notes,
    priority: row.priority,
    status: own ? "wanted" : row.status,
    claimedBy: own || row.status === "wanted" ? null : row.claimed_by_name || "Someone",
    claimedByMe: !own && row.claimed_by_user_id === viewer.id,
    createdAt: row.created_at,
  };
}

function safeUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 500);
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanItem(input: Record<string, unknown>, base?: Row): { ok: true; value: Omit<Row, "id" | "household_id" | "person_id" | "created_at" | "status" | "claimed_by_user_id" | "claimed_by_name"> } | { ok: false; reason: string } {
  const title = input.title !== undefined ? (typeof input.title === "string" ? input.title.trim().slice(0, 120) : "") : (base?.title ?? "");
  if (!title) return { ok: false, reason: "Give the item a title." };
  const url = input.url !== undefined ? safeUrl(input.url) : (base?.url ?? "");
  if (url === null) return { ok: false, reason: "That link doesn’t look like a web address." };
  let price = base?.price ?? null;
  if (input.price !== undefined) {
    if (input.price === null || input.price === "") price = null;
    else {
      const n = Number(input.price);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { ok: false, reason: "Price should be a number." };
      price = Math.round(n * 100) / 100;
    }
  }
  const priority = input.priority !== undefined ? Number(input.priority) : (base?.priority ?? 2);
  if (priority !== 1 && priority !== 2 && priority !== 3) return { ok: false, reason: "Priority is 1, 2 or 3." };
  const text = (value: unknown, fallback: string, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : fallback);
  return {
    ok: true,
    value: {
      title,
      url,
      price,
      size: input.size !== undefined ? text(input.size, "", 40) : (base?.size ?? ""),
      notes: input.notes !== undefined ? text(input.notes, "", 400) : (base?.notes ?? ""),
      priority: priority as 1 | 2 | 3,
    },
  };
}

function rowOf(db: Db, id: string): Row | undefined {
  return db.prepare(`SELECT ${COLS} FROM wishlist_items WHERE id = ?`).get(id) as Row | undefined;
}

export function listWishlist(ctx: Ctx, viewer: User, personId?: string): WishItem[] {
  const rows = (personId
    ? ctx.db.prepare(`SELECT ${COLS} FROM wishlist_items WHERE household_id = ? AND person_id = ? ORDER BY priority, seq`).all(ctx.hid, personId)
    : ctx.db.prepare(`SELECT ${COLS} FROM wishlist_items WHERE household_id = ? ORDER BY priority, seq`).all(ctx.hid)) as Row[];
  return rows.map((row) => viewItem(row, viewer));
}

/** Items on shared people's lists in households linked to this one. */
export function sharedWishlists(db: Db, viewer: User) {
  const out: {
    household: { id: string; name: string };
    person: { id: string; name: string; relationship: string; role: string };
    items: WishItem[];
  }[] = [];
  for (const otherId of linkedHouseholdIds(db, viewer.householdId)) {
    const house = householdRow(db, otherId);
    if (!house) continue;
    const people = listPeople({ db, hid: otherId, me: null }).filter((p) => p.shared);
    for (const person of people) {
      const rows = db
        .prepare(`SELECT ${COLS} FROM wishlist_items WHERE household_id = ? AND person_id = ? ORDER BY priority, seq`)
        .all(otherId, person.id) as Row[];
      out.push({
        household: { id: house.id, name: house.name },
        person: { id: person.id, name: person.name, relationship: person.relationship, role: person.role },
        items: rows.map((row) => viewItem(row, viewer)),
      });
    }
  }
  return out;
}

type ClaimResult = { ok: true; item: WishItem } | { ok: false; status: 400 | 403 | 404 | 409; reason: string };

/** Reserve, buy or release an item. Allowed for anyone who can see the list, except the list's own person. */
export function claimItem(db: Db, viewer: User, id: string, status: unknown): ClaimResult {
  const row = rowOf(db, id);
  if (!row) return { ok: false, status: 404, reason: "That wishlist item is gone." };
  const same = row.household_id === viewer.householdId;
  if (!same) {
    const person = db.prepare("SELECT shared FROM people WHERE id = ?").get(row.person_id) as { shared: number } | undefined;
    if (!person?.shared || !areLinked(db, viewer.householdId, row.household_id)) {
      return { ok: false, status: 404, reason: "That wishlist item is gone." };
    }
  }
  if (viewer.personId && viewer.personId === row.person_id) {
    return { ok: false, status: 403, reason: "It’s your own list, so reserving is left to everyone else. That keeps the surprise." };
  }
  if (status !== "wanted" && status !== "reserved" && status !== "purchased") {
    return { ok: false, status: 400, reason: "Status is wanted, reserved or purchased." };
  }
  if (status === "wanted") {
    if (row.status !== "wanted" && row.claimed_by_user_id && row.claimed_by_user_id !== viewer.id && viewer.role !== "owner") {
      return { ok: false, status: 403, reason: `${row.claimed_by_name || "Someone else"} reserved this one.` };
    }
    db.prepare("UPDATE wishlist_items SET status = 'wanted', claimed_by_user_id = NULL, claimed_by_name = '', updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      id,
    );
  } else {
    if (row.status !== "wanted" && row.claimed_by_user_id && row.claimed_by_user_id !== viewer.id) {
      return { ok: false, status: 409, reason: `${row.claimed_by_name || "Someone else"} already ${row.status === "purchased" ? "bought" : "reserved"} this one.` };
    }
    db.prepare("UPDATE wishlist_items SET status = ?, claimed_by_user_id = ?, claimed_by_name = ?, updated_at = ? WHERE id = ?").run(
      status,
      viewer.id,
      viewer.displayName,
      new Date().toISOString(),
      id,
    );
  }
  return { ok: true, item: viewItem(rowOf(db, id)!, viewer) };
}

export const wishlistHandler: Handler = async (c: ApiCall) => {
  const { ctx, db, method, id, rest, body, resource, session } = c;
  const viewer = session.user;

  if (resource === "shared" && id === "wishlists" && method === "GET" && rest.length === 0) {
    return json({ lists: sharedWishlists(db, viewer) });
  }
  if (resource === "shared" && id === "wishlist" && method === "PATCH" && rest.length === 1) {
    const itemId = decodeURIComponent(rest[0]!);
    const result = claimItem(db, viewer, itemId, (body as { status?: unknown })?.status);
    return result.ok ? json({ item: result.item }) : error(result.status, result.reason);
  }

  if (resource !== "wishlist") return null;

  if (method === "GET" && id === undefined) {
    const personId = c.url.searchParams.get("personId") ?? undefined;
    if (personId && !getPerson(ctx, personId)) return error(404, "That person is gone.");
    return json({ items: listWishlist(ctx, viewer, personId) });
  }

  if (method === "POST" && id === undefined) {
    const input = (body ?? {}) as Record<string, unknown>;
    const personId = typeof input.personId === "string" ? input.personId : "";
    if (!getPerson(ctx, personId)) return error(400, "Pick a person from your household.");
    const clean = cleanItem(input);
    if (!clean.ok) return error(400, clean.reason);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM wishlist_items WHERE person_id = ?").get(personId) as { n: number }).n;
    if (count >= 200) return error(409, "That list is full (200 items).");
    const itemId = randomUUID();
    const now = new Date().toISOString();
    const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM wishlist_items").get() as { n: number }).n;
    db.prepare(
      `INSERT INTO wishlist_items (id, household_id, person_id, seq, title, url, price, size, notes, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(itemId, ctx.hid, personId, seq, clean.value.title, clean.value.url, clean.value.price, clean.value.size, clean.value.notes, clean.value.priority, now, now);
    return json({ item: viewItem(rowOf(db, itemId)!, viewer) }, { status: 201 });
  }

  const row = id ? rowOf(db, id) : undefined;
  const mine = row && row.household_id === ctx.hid ? row : undefined;
  if (id === undefined) return null;

  if (method === "PATCH" && rest.length === 0) {
    if (!mine) return error(404, "That wishlist item is gone.");
    const input = (body ?? {}) as Record<string, unknown>;
    const own = Boolean(viewer.personId) && viewer.personId === mine.person_id;
    if (own && input.status !== undefined) return error(403, "Reserving is left to everyone else. That keeps the surprise.");
    if (input.status !== undefined) {
      const claimed = claimItem(db, viewer, id, input.status);
      if (!claimed.ok) return error(claimed.status, claimed.reason);
    }
    const hasFields = ["title", "url", "price", "size", "notes", "priority"].some((key) => input[key] !== undefined);
    if (hasFields) {
      const clean = cleanItem(input, mine);
      if (!clean.ok) return error(400, clean.reason);
      db.prepare("UPDATE wishlist_items SET title = ?, url = ?, price = ?, size = ?, notes = ?, priority = ?, updated_at = ? WHERE id = ?").run(
        clean.value.title, clean.value.url, clean.value.price, clean.value.size, clean.value.notes, clean.value.priority, new Date().toISOString(), id,
      );
    }
    return json({ item: viewItem(rowOf(db, id)!, viewer) });
  }

  if (method === "DELETE" && rest.length === 0) {
    if (!mine) return error(404, "That wishlist item is gone.");
    db.prepare("DELETE FROM wishlist_items WHERE id = ?").run(id);
    return json({ ok: true });
  }

  if (method === "POST" && rest[0] === "convert") {
    if (!mine) return error(404, "That wishlist item is gone.");
    if (viewer.personId && viewer.personId === mine.person_id) {
      return error(403, "That’s on your own list. Someone else plans gifts for you.");
    }
    if (mine.status !== "wanted" && mine.claimed_by_user_id && mine.claimed_by_user_id !== viewer.id) {
      return error(409, `${mine.claimed_by_name || "Someone else"} already ${mine.status === "purchased" ? "bought" : "reserved"} this one.`);
    }
    const input = (body ?? {}) as { occasion?: unknown; date?: unknown; giverId?: unknown };
    const giverId =
      typeof input.giverId === "string" && getPerson(ctx, input.giverId)
        ? input.giverId
        : (viewer.personId ?? listPeople(ctx).find((p) => p.relationship === "self")?.id ?? listPeople(ctx)[0]?.id);
    if (!giverId) return error(400, "Add yourself to the household first.");
    const occasion = typeof input.occasion === "string" && input.occasion.trim() ? input.occasion.trim() : (listOccasions(ctx)[0] ?? "Just because");
    const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toISOString().slice(0, 10);
    const note = [mine.url, mine.size ? `Size: ${mine.size}` : "", mine.notes].filter(Boolean).join(" · ").slice(0, 400);
    let result: ReturnType<typeof addGift> | undefined;
    transaction(db, () => {
      result = addGift(ctx, {
        direction: "given",
        title: mine.title,
        occasion,
        date,
        giverId,
        receiverId: mine.person_id,
        amount: mine.price,
        status: "idea",
        thanked: false,
        note,
      });
      if (result.ok) {
        db.prepare("UPDATE wishlist_items SET status = 'reserved', claimed_by_user_id = ?, claimed_by_name = ?, updated_at = ? WHERE id = ?").run(
          viewer.id, viewer.displayName, new Date().toISOString(), id,
        );
      }
    });
    if (!result || !result.ok) return error(result && !result.ok ? result.status : 400, result && !result.ok ? result.reason : "Couldn’t make that gift.");
    return json({ gift: result.gift, item: viewItem(rowOf(db, id)!, viewer) }, { status: 201 });
  }
  return null;
};
