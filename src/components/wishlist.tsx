import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Gift as GiftIcon, Pencil, Plus, ShoppingBag, Trash2, Undo2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { ApiError } from "@/lib/gifts/api";
import { xapi, type WishItem, type WishStatus } from "@/lib/gifts/api-extra";
import { formatMoney } from "@/lib/gifts/model";
import { toast } from "@/lib/toast";

const PRIORITY = { 1: "Really want", 2: "Would like", 3: "Nice to have" } as const;
const msg = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

type Draft = { title: string; url: string; price: string; size: string; notes: string; priority: 1 | 2 | 3 };
const blank: Draft = { title: "", url: "", price: "", size: "", notes: "", priority: 2 };

function ItemForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
  busy: boolean;
  error: string;
}) {
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(draft);
  }
  return (
    <form className="wish-form" onSubmit={submit}>
      <Field label="Item">
        <TextInput autoFocus value={draft.title} maxLength={120} placeholder="What would they love?" onChange={(e) => set("title", e.target.value)} />
      </Field>
      <div className="wish-form-row">
        <Field label="Link">
          <TextInput value={draft.url} inputMode="url" placeholder="Optional" onChange={(e) => set("url", e.target.value)} />
        </Field>
        <Field label="Price">
          <TextInput value={draft.price} inputMode="decimal" placeholder="Optional" onChange={(e) => set("price", e.target.value)} />
        </Field>
      </div>
      <div className="wish-form-row">
        <Field label="Size">
          <TextInput value={draft.size} maxLength={40} placeholder="Optional" onChange={(e) => set("size", e.target.value)} />
        </Field>
        <label className="lbl">
          Priority
          <span className="select-wrap">
            <select className="field" value={draft.priority} onChange={(e) => set("priority", Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>{PRIORITY[1]}</option>
              <option value={2}>{PRIORITY[2]}</option>
              <option value={3}>{PRIORITY[3]}</option>
            </select>
          </span>
        </label>
      </div>
      <Field label="Notes">
        <TextInput value={draft.notes} maxLength={400} placeholder="Color, store, anything helpful" onChange={(e) => set("notes", e.target.value)} />
      </Field>
      {error ? (
        <p className="text-sm text-primary" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !draft.title.trim()}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const toPayload = (d: Draft) => ({
  title: d.title,
  url: d.url,
  price: d.price.trim() === "" ? null : Number(d.price.replace(/[^0-9.]/g, "")),
  size: d.size,
  notes: d.notes,
  priority: d.priority,
});

/** A person's wishlist. On your own list you can add and edit, but never see who reserved what. */
export function WishlistSection({ personId, personName, isSelf }: { personId: string; personName: string; isSelf: boolean }) {
  const queryClient = useQueryClient();
  const key = ["wishlist", personId] as const;
  const list = useQuery({ queryKey: key, queryFn: () => xapi.wishlist(personId) });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: (d: Draft) => xapi.addWish({ personId, ...toPayload(d) }),
    onSuccess: () => {
      setAdding(false);
      setError("");
      void refresh();
    },
    onError: (e) => setError(msg(e, "Couldn’t add that.")),
  });
  const edit = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Draft }) => xapi.updateWish(id, toPayload(d)),
    onSuccess: () => {
      setEditing(null);
      setError("");
      void refresh();
    },
    onError: (e) => setError(msg(e, "Couldn’t save that.")),
  });
  const claim = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WishStatus }) => xapi.updateWish(id, { status }),
    onSuccess: () => void refresh(),
    onError: (e) => toast(msg(e, "Couldn’t update that.")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => xapi.removeWish(id),
    onSuccess: () => void refresh(),
  });
  const convert = useMutation({
    mutationFn: (id: string) => xapi.convertWish(id),
    onSuccess: () => {
      toast("Added to the ledger as a gift idea");
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e) => toast(msg(e, "Couldn’t make that a gift.")),
  });

  const items = list.data?.items ?? [];

  return (
    <section className="card" aria-labelledby="wish-title" data-tour="wishlist">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="wish-title">
            Wishlist
          </h2>
          <p className="card-sub">
            {isSelf
              ? "Add what you’d like. Others can reserve items without you seeing which."
              : `Ideas for ${personName.split(" ")[0]}. Reserve one so nobody double-buys.`}
          </p>
        </div>
        {!adding ? (
          <Button variant="secondary" pill small onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={1.75} />
            Add
          </Button>
        ) : null}
      </div>
      {adding ? (
        <ItemForm initial={blank} submitLabel="Add to wishlist" busy={add.isPending} error={error} onCancel={() => { setAdding(false); setError(""); }} onSubmit={(d) => add.mutate(d)} />
      ) : null}
      {list.isLoading ? <p className="mt-4 text-sm text-muted">Loading…</p> : null}
      {!list.isLoading && items.length === 0 && !adding ? (
        <p className="mt-4 text-sm text-muted">Nothing on the list yet.</p>
      ) : null}
      <ul className="wish-list">
        {items.map((item) =>
          editing === item.id ? (
            <li key={item.id} className="wish">
              <ItemForm
                initial={{ title: item.title, url: item.url, price: item.price === null ? "" : String(item.price), size: item.size, notes: item.notes, priority: item.priority }}
                submitLabel="Save"
                busy={edit.isPending}
                error={error}
                onCancel={() => { setEditing(null); setError(""); }}
                onSubmit={(d) => edit.mutate({ id: item.id, d })}
              />
            </li>
          ) : (
            <WishRow
              key={item.id}
              item={item}
              isSelf={isSelf}
              onEdit={() => { setEditing(item.id); setError(""); }}
              onDelete={() => remove.mutate(item.id)}
              onClaim={(status) => claim.mutate({ id: item.id, status })}
              onConvert={() => convert.mutate(item.id)}
            />
          ),
        )}
      </ul>
    </section>
  );
}

export function WishRow({
  item,
  isSelf,
  onEdit,
  onDelete,
  onClaim,
  onConvert,
}: {
  item: WishItem;
  isSelf: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onClaim: (status: WishStatus) => void;
  onConvert?: () => void;
}) {
  const taken = item.status !== "wanted";
  return (
    <li className={`wish${taken ? " is-taken" : ""}`}>
      <div className="wish-main">
        <p className="wish-title">
          {item.url && /^https?:\/\//i.test(item.url) ? (
            <a href={item.url} target="_blank" rel="noreferrer noopener">
              {item.title}
              <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            item.title
          )}
        </p>
        <p className="wish-meta">
          <span className={`chip-soft is-p${item.priority}`}>{PRIORITY[item.priority]}</span>
          {item.price !== null ? <span>{formatMoney(item.price)}</span> : null}
          {item.size ? <span>Size {item.size}</span> : null}
          {item.notes ? <span>{item.notes}</span> : null}
        </p>
        {taken ? (
          <p className="wish-claim" role="status">
            <Check size={13} strokeWidth={2} aria-hidden="true" />
            {item.claimedByMe ? "You" : (item.claimedBy ?? "Someone")} {item.status === "purchased" ? "bought this" : "reserved this"}
          </p>
        ) : null}
      </div>
      <div className="wish-actions">
        {!isSelf ? (
          taken ? (
            item.claimedByMe ? (
              <>
                {item.status === "reserved" ? (
                  <Button small variant="secondary" onClick={() => onClaim("purchased")}>
                    <ShoppingBag size={13} strokeWidth={1.5} /> Bought
                  </Button>
                ) : null}
                <Button small variant="ghost" onClick={() => onClaim("wanted")} aria-label={`Release ${item.title}`}>
                  <Undo2 size={13} strokeWidth={1.5} /> Release
                </Button>
              </>
            ) : null
          ) : (
            <>
              <Button small variant="secondary" onClick={() => onClaim("reserved")}>
                Reserve
              </Button>
              <Button small variant="ghost" onClick={() => onClaim("purchased")}>
                Bought it
              </Button>
            </>
          )
        ) : null}
        {!isSelf && onConvert && (!taken || item.claimedByMe) ? (
          <Button small variant="ghost" onClick={onConvert} aria-label={`Make ${item.title} a gift`}>
            <GiftIcon size={13} strokeWidth={1.5} /> To gift
          </Button>
        ) : null}
        {onEdit ? (
          <button type="button" className="icon-btn sm" aria-label={`Edit ${item.title}`} onClick={onEdit}>
            <Pencil size={14} strokeWidth={1.5} />
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" className="icon-btn sm" aria-label={`Remove ${item.title}`} onClick={onDelete}>
            {isSelf ? <X size={14} /> : <Trash2 size={14} strokeWidth={1.5} />}
          </button>
        ) : null}
      </div>
    </li>
  );
}
