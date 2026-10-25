import { useEffect, useState } from "react";
import { Button, Field, Sheet, TextInput } from "@/components/ui";
import { useOverlay } from "@/components/overlay";
import { RelationshipSelect } from "@/components/relationship-select";
import {
  formatDate,
  giftsForPerson,
  normalizeRelationship,
  personName,
  relationshipLabel,
  type Circle,
  type Person,
  type Relationship,
} from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

/** "--12-02" shows as "12-02"; a full date stays as is. */
const showDate = (value: string | null | undefined) => (value ? value.replace(/^--/, "") : "");

/** "" -> null (cleared), valid input -> stored form, anything else -> false. */
function parseDateInput(value: string): string | null | false {
  const text = value.trim();
  if (!text) return null;
  const short = /^(\d{1,2})[-/](\d{1,2})$/.exec(text);
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const pad = (n: string) => n.padStart(2, "0");
  const [y, m, d] = full ? [full[1]!, full[2]!, full[3]!] : short ? [null, short[1]!, short[2]!] : [null, "", ""];
  if (!m || Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return false;
  return y ? `${y}-${pad(m)}-${pad(d)}` : `--${pad(m)}-${pad(d)}`;
}

export function PersonSheet() {
  const { overlay, open, close } = useOverlay();
  const editing = overlay.type === "person" ? overlay : null;
  const people = useLedger((state) => state.people);
  const gifts = useLedger((state) => state.gifts);
  const addPerson = useLedger((state) => state.addPerson);
  const updatePerson = useLedger((state) => state.updatePerson);
  const removePerson = useLedger((state) => state.removePerson);

  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<Relationship>("friend");
  const [custom, setCustom] = useState("");
  const [circle, setCircle] = useState<Circle>("outside");
  const [birthday, setBirthday] = useState("");
  const [anniversary, setAnniversary] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const personKey = editing ? (editing.id ?? "new") : "";

  useEffect(() => {
    if (!editing) return;
    const existing = editing.id ? useLedger.getState().people.find((person) => person.id === editing.id) : undefined;
    setName(existing?.name ?? "");
    setRelationship(existing ? normalizeRelationship(existing.relationship, existing.role) : "friend");
    setCustom(existing && existing.relationship === "other" ? existing.role : "");
    setCircle(existing?.circle ?? "outside");
    setBirthday(showDate(existing?.birthday));
    setAnniversary(showDate(existing?.anniversary));
    setError("");
    setConfirmDelete(false);
  }, [personKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when a different person opens

  const existing = editing?.id ? people.find((person) => person.id === editing.id) : undefined;
  const history = existing ? giftsForPerson(gifts, existing.id) : [];

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Add a name.");
      return;
    }
    const bday = parseDateInput(birthday);
    const anniv = parseDateInput(anniversary);
    if (bday === false || anniv === false) {
      setError("Dates look like 2016-12-02, or 12-02 when you don’t know the year.");
      return;
    }
    const next: Person = {
      id: existing?.id ?? crypto.randomUUID(),
      name: trimmed.slice(0, 80),
      role: relationship === "other" ? custom.trim().slice(0, 40) || "Other" : relationshipLabel(relationship),
      circle,
      relationship,
      birthday: bday,
      anniversary: anniv,
    };
    if (existing) updatePerson(existing.id, next);
    else addPerson(next);
    close();
  }

  return (
    <Sheet
      open={Boolean(editing)}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={existing ? existing.name : "Add a person"}
      description={existing ? "Gifts they gave and gifts they got." : "Household or someone you exchange gifts with."}
    >
      <form
        className="flex flex-col gap-4 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field label="Name">
          <TextInput value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Relationship">
          <RelationshipSelect value={relationship} onChange={setRelationship} />
        </Field>
        {relationship === "other" ? (
          <Field label="Describe them" hint="Neighbor, coworker, teacher">
            <TextInput value={custom} maxLength={40} onChange={(event) => setCustom(event.target.value)} />
          </Field>
        ) : null}
        <div className="segment cols-2" role="group" aria-label="Circle">
          {(
            [
              ["household", "Household"],
              ["outside", "Outside"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={circle === value ? "is-on" : ""}
              onClick={() => setCircle(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="wish-form-row">
          <Field label="Birthday" hint="2016-12-02, or 12-02">
            <TextInput value={birthday} placeholder="Optional" inputMode="numeric" onChange={(event) => setBirthday(event.target.value)} />
          </Field>
          <Field label="Anniversary" hint="Optional">
            <TextInput value={anniversary} placeholder="Optional" inputMode="numeric" onChange={(event) => setAnniversary(event.target.value)} />
          </Field>
        </div>

        {error ? (
          <p className="text-sm text-primary" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" block>
          Save person
        </Button>

        {existing ? (
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
                  const result = removePerson(existing.id);
                  if (!result.ok) {
                    setError(result.reason);
                    setConfirmDelete(false);
                    return;
                  }
                  close();
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <Button type="button" variant="danger" block onClick={() => setConfirmDelete(true)}>
              Remove person
            </Button>
          )
        ) : null}
      </form>

      {existing && history.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2 border-t border-border pt-4">
          {history.map((gift) => (
            <li key={gift.id}>
              <button
                type="button"
                className="row-main rounded-lg px-0"
                onClick={() => open({ type: "gift", id: gift.id })}
              >
                <span className="font-medium">{gift.title}</span>
                <span className="mt-1 block text-sm text-muted">
                  {gift.giverId === existing.id ? "Gave" : "Got"} · {personName(people, gift.giverId === existing.id ? gift.receiverId : gift.giverId)} · {formatDate(gift.date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  );
}
