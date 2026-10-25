import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Field, Sheet, Switch, TextArea, TextInput } from "@/components/ui";
import { useOverlay } from "@/components/overlay";
import { statusLabel, todayISO, type Direction, type Gift, type GiftStatus } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

type Draft = {
  direction: Direction;
  title: string;
  occasion: string;
  date: string;
  giverId: string;
  receiverId: string;
  amount: string;
  status: GiftStatus;
  thanked: boolean;
  note: string;
};

const STATUSES: GiftStatus[] = ["idea", "purchased", "delivered"];

function pickOccasion(occasions: string[]): string {
  const month = Number(todayISO().slice(5, 7));
  const match = (name: string) => occasions.find((item) => item.toLowerCase() === name);
  if (month === 12) return match("christmas") ?? occasions[0] ?? "Christmas";
  return match("birthday") ?? occasions[0] ?? "Birthday";
}

function defaultDraft(
  people: { id: string; circle: "household" | "outside" }[],
  occasions: string[],
  options: { direction?: Direction; giverId?: string; receiverId?: string },
): Draft {
  const direction = options.direction ?? "received";
  const household = people.filter((person) => person.circle === "household");
  const outside = people.filter((person) => person.circle === "outside");
  const self = household[0]?.id ?? people[0]?.id ?? "";
  const other = outside[0]?.id ?? household[1]?.id ?? people.find((person) => person.id !== self)?.id ?? "";
  return {
    direction,
    title: "",
    occasion: pickOccasion(occasions),
    date: todayISO(),
    giverId: options.giverId ?? (direction === "received" ? other : self),
    receiverId: options.receiverId ?? (direction === "received" ? self : other),
    amount: "",
    status: direction === "received" ? "delivered" : "idea",
    thanked: false,
    note: "",
  };
}

function fromGift(gift: Gift): Draft {
  return {
    direction: gift.direction,
    title: gift.title,
    occasion: gift.occasion,
    date: gift.date,
    giverId: gift.giverId,
    receiverId: gift.receiverId,
    amount: gift.amount == null ? "" : String(gift.amount),
    status: gift.status,
    thanked: gift.thanked,
    note: gift.note,
  };
}

function parseAmount(raw: string): number | null | "bad" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(/[$,]/g, ""));
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return "bad";
  return Math.round(value * 100) / 100;
}

export function GiftSheet() {
  const { overlay, open, close } = useOverlay();
  const openGift = overlay.type === "gift" ? overlay : null;
  const people = useLedger((state) => state.people);
  const gifts = useLedger((state) => state.gifts);
  const occasions = useLedger((state) => state.occasions);
  const addGift = useLedger((state) => state.addGift);
  const updateGift = useLedger((state) => state.updateGift);
  const removeGift = useLedger((state) => state.removeGift);
  const addPerson = useLedger((state) => state.addPerson);

  const [draft, setDraft] = useState<Draft>(() => defaultDraft(people, occasions, {}));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState<"giver" | "receiver" | null>(null);

  const giftKey = openGift
    ? `${openGift.id ?? "new"}:${openGift.direction ?? ""}:${openGift.giverId ?? ""}:${openGift.receiverId ?? ""}`
    : "";

  useEffect(() => {
    if (!openGift) return;
    const existing = openGift.id ? gifts.find((gift) => gift.id === openGift.id) : undefined;
    setDraft(
      existing ? fromGift(existing) : defaultDraft(useLedger.getState().people, useLedger.getState().occasions, openGift),
    );
    setError("");
    setConfirmDelete(false);
    setNewName("");
    setNewTarget(null);
  }, [giftKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when a different gift opens

  function save() {
    const title = draft.title.trim();
    if (!title) {
      setError("Name the gift.");
      return;
    }
    if (!draft.giverId || !draft.receiverId || draft.giverId === draft.receiverId) {
      setError("Pick two different people.");
      return;
    }
    if (!draft.date) {
      setError("Add a date.");
      return;
    }
    const amount = parseAmount(draft.amount);
    if (amount === "bad") {
      setError("Enter a dollar amount, or leave it blank.");
      return;
    }
    const next: Gift = {
      id: openGift?.id ?? crypto.randomUUID(),
      direction: draft.direction,
      title: title.slice(0, 120),
      occasion: draft.occasion.trim().slice(0, 60) || occasions[0] || "Just because",
      date: draft.date,
      giverId: draft.giverId,
      receiverId: draft.receiverId,
      amount,
      status: draft.direction === "received" ? "delivered" : draft.status,
      thanked: draft.direction === "received" ? draft.thanked : false,
      note: draft.note.trim().slice(0, 400),
    };
    if (openGift?.id) updateGift(next.id, next);
    else addGift(next);
    close();
  }

  const occasionOptions =
    draft.occasion && !occasions.includes(draft.occasion) ? [draft.occasion, ...occasions] : occasions;

  function createPerson() {
    const name = newName.trim();
    if (!name || !newTarget) return;
    const id = crypto.randomUUID();
    addPerson({ id, name: name.slice(0, 80), role: "", circle: "outside" });
    setDraft((current) => ({ ...current, [newTarget === "giver" ? "giverId" : "receiverId"]: id }));
    setNewName("");
    setNewTarget(null);
  }

  return (
    <Sheet
      open={Boolean(openGift)}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={openGift?.id ? "Edit gift" : "Log a gift"}
      description="What moved between people."
      footer={
        <>
          {error ? (
            <p className="text-sm text-primary" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" form="gift-form" block>
            Save gift
          </Button>
        </>
      }
    >
      <form
        id="gift-form"
        className="flex flex-col gap-4 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="segment cols-2" role="group" aria-label="Direction">
          {(["received", "given"] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              className={draft.direction === direction ? "is-on" : ""}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  direction,
                  status:
                    direction === "given" && current.direction === "received" && !openGift?.id
                      ? "idea"
                      : current.status,
                }))
              }
            >
              {direction === "received" ? "Received" : "Given"}
            </button>
          ))}
        </div>

        <Field label="Gift">
          <TextInput
            value={draft.title}
            maxLength={120}
            placeholder="Cast-iron skillet"
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>

        <PersonField
          label="From"
          people={people}
          value={draft.giverId}
          onChange={(giverId) => setDraft((current) => ({ ...current, giverId }))}
          adding={newTarget === "giver"}
          onAdd={() => setNewTarget("giver")}
        />
        <PersonField
          label="To"
          people={people}
          value={draft.receiverId}
          onChange={(receiverId) => setDraft((current) => ({ ...current, receiverId }))}
          adding={newTarget === "receiver"}
          onAdd={() => setNewTarget("receiver")}
        />

        {newTarget ? (
          <div className="flex gap-2">
            <TextInput
              value={newName}
              placeholder="Name"
              maxLength={80}
              aria-label="New person"
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button type="button" variant="secondary" onClick={createPerson}>
              Add
            </Button>
          </div>
        ) : null}

        <Field label="Occasion">
          <div className="select-wrap">
            <select
              className="field"
              value={draft.occasion}
              onChange={(event) => setDraft((current) => ({ ...current, occasion: event.target.value }))}
            >
              {occasionOptions.map((occasion) => (
                <option key={occasion} value={occasion}>
                  {occasion}
                </option>
              ))}
            </select>
            <ChevronDown className="select-chevron" />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <TextInput
              type="date"
              value={draft.date}
              onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
            />
          </Field>
          <Field label="Amount" hint="Optional">
            <TextInput
              inputMode="decimal"
              placeholder="0"
              value={draft.amount}
              onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
            />
          </Field>
        </div>

        {draft.direction === "given" ? (
          <div>
            <p className="lbl mb-2">Plan</p>
            <div className="segment cols-3" role="group" aria-label="Plan">
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={draft.status === status ? "is-on" : ""}
                  onClick={() => setDraft((current) => ({ ...current, status }))}
                >
                  {statusLabel(status)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Switch
            label="Thank-you sent"
            checked={draft.thanked}
            onChange={(thanked) => setDraft((current) => ({ ...current, thanked }))}
          />
        )}

        <Field label="Note">
          <TextArea
            value={draft.note}
            maxLength={400}
            placeholder="Size, shop, or anything you want to remember"
            onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          />
        </Field>

        {openGift?.id ? (
          confirmDelete ? (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" block onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button
                type="button"
                variant="danger"
                block
                onClick={() => {
                  removeGift(openGift.id as string);
                  close();
                }}
              >
                Delete
              </Button>
            </div>
          ) : (
            <Button type="button" variant="danger" block onClick={() => setConfirmDelete(true)}>
              Delete gift
            </Button>
          )
        ) : (
          <Button type="button" variant="ghost" block onClick={() => open({ type: "person", id: null })}>
            Add a person instead
          </Button>
        )}
      </form>
    </Sheet>
  );
}

function PersonField({
  label,
  people,
  value,
  onChange,
  adding,
  onAdd,
}: {
  label: string;
  people: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  adding: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Field label={label}>
        <div className="select-wrap">
          <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">Choose</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <ChevronDown className="select-chevron" />
        </div>
      </Field>
      {!adding ? (
        <button type="button" className="text-link self-start" onClick={onAdd}>
          New person
        </button>
      ) : null}
    </div>
  );
}
