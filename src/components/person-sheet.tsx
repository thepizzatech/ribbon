import { useEffect, useState } from "react";
import { Button, Field, Sheet, TextInput } from "@/components/ui";
import { useOverlay } from "@/components/overlay";
import { formatDate, giftsForPerson, personName, type Circle, type Person } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

export function PersonSheet() {
  const { overlay, open, close } = useOverlay();
  const editing = overlay.type === "person" ? overlay : null;
  const people = useLedger((state) => state.people);
  const gifts = useLedger((state) => state.gifts);
  const addPerson = useLedger((state) => state.addPerson);
  const updatePerson = useLedger((state) => state.updatePerson);
  const removePerson = useLedger((state) => state.removePerson);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [circle, setCircle] = useState<Circle>("outside");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const personKey = editing ? (editing.id ?? "new") : "";

  useEffect(() => {
    if (!editing) return;
    const existing = editing.id ? useLedger.getState().people.find((person) => person.id === editing.id) : undefined;
    setName(existing?.name ?? "");
    setRole(existing?.role ?? "");
    setCircle(existing?.circle ?? "outside");
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
    const next: Person = {
      id: existing?.id ?? crypto.randomUUID(),
      name: trimmed.slice(0, 80),
      role: role.trim().slice(0, 40),
      circle,
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
        <Field label="Relation" hint="Partner, aunt, friend">
          <TextInput value={role} maxLength={40} onChange={(event) => setRole(event.target.value)} />
        </Field>
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
