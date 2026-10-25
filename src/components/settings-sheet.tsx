import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Field, Sheet, TextInput } from "@/components/ui";
import { useOverlay } from "@/components/overlay";
import { parseBackup } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

export function SettingsSheet() {
  const { overlay, close } = useOverlay();
  const open = overlay.type === "settings";
  const householdName = useLedger((state) => state.householdName);
  const occasions = useLedger((state) => state.occasions);
  const setHouseholdName = useLedger((state) => state.setHouseholdName);
  const addOccasion = useLedger((state) => state.addOccasion);
  const renameOccasion = useLedger((state) => state.renameOccasion);
  const removeOccasion = useLedger((state) => state.removeOccasion);
  const clearLedger = useLedger((state) => state.clearLedger);
  const loadSample = useLedger((state) => state.loadSample);
  const importBackup = useLedger((state) => state.importBackup);
  const [name, setName] = useState(householdName);
  const [rows, setRows] = useState(occasions);
  const [nextOccasion, setNextOccasion] = useState("");
  const [message, setMessage] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const state = useLedger.getState();
    setName(state.householdName);
    setRows(state.occasions);
    setNextOccasion("");
    setMessage("");
    setConfirmClear(false);
  }, [open]);

  function syncOccasions() {
    setRows(useLedger.getState().occasions);
  }

  function exportLedger() {
    const state = useLedger.getState();
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            householdName: state.householdName,
            people: state.people,
            gifts: state.gifts,
            occasions: state.occasions,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ribbon-ledger.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="This device"
      description="The ledger stays in this browser until you export it."
    >
      <div className="flex flex-col gap-5 pb-2">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setHouseholdName(name);
            setMessage("Household name saved.");
          }}
        >
          <Field label="Household name">
            <TextInput value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Button type="submit" block>
            Save name
          </Button>
        </form>

        <section className="flex flex-col gap-2">
          <div>
            <p className="lbl">Occasions</p>
            <p className="mt-1 text-sm font-normal text-muted">These are the choices when you log a gift.</p>
          </div>
          <ul className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <li key={index} className="occasion-row">
                <TextInput
                  value={row}
                  maxLength={60}
                  aria-label={`Occasion ${index + 1}`}
                  onChange={(event) =>
                    setRows((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
                  }
                  onBlur={(event) => {
                    const result = renameOccasion(index, event.currentTarget.value);
                    syncOccasions();
                    setMessage(result.ok ? "" : result.reason);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.currentTarget.blur();
                  }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${occasions[index] ?? "occasion"}`}
                  onClick={() => {
                    const result = removeOccasion(index);
                    syncOccasions();
                    if (!result.ok) setMessage(result.reason);
                  }}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <TextInput
              value={nextOccasion}
              maxLength={60}
              placeholder="Add an occasion"
              aria-label="New occasion"
              onChange={(event) => setNextOccasion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const result = addOccasion(nextOccasion);
                syncOccasions();
                if (result.ok) {
                  setNextOccasion("");
                  setMessage("");
                } else setMessage(result.reason);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const result = addOccasion(nextOccasion);
                syncOccasions();
                if (result.ok) {
                  setNextOccasion("");
                  setMessage("");
                } else setMessage(result.reason);
              }}
            >
              Add
            </Button>
          </div>
        </section>

        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" block onClick={exportLedger}>
            Export ledger
          </Button>
          <Button type="button" variant="secondary" block onClick={() => fileRef.current?.click()}>
            Import ledger
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const parsed = parseBackup(String(reader.result ?? ""));
                if (!parsed || parsed.people.length === 0) {
                  setMessage("That file isn’t a Ribbon ledger.");
                  return;
                }
                importBackup(parsed);
                setName(parsed.householdName);
                syncOccasions();
                setMessage("Ledger replaced from the file.");
              };
              reader.readAsText(file);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            block
            onClick={() => {
              loadSample();
              setName("The Coles");
              syncOccasions();
              setMessage("Sample household loaded.");
            }}
          >
            Load sample household
          </Button>
          {confirmClear ? (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" block onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                block
                onClick={() => {
                  clearLedger();
                  setName(useLedger.getState().householdName);
                  syncOccasions();
                  setConfirmClear(false);
                  setMessage("Ledger cleared.");
                }}
              >
                Clear all
              </Button>
            </div>
          ) : (
            <Button type="button" variant="danger" block onClick={() => setConfirmClear(true)}>
              Clear ledger
            </Button>
          )}
          {message ? <p className="text-sm text-muted">{message}</p> : null}
          <p className="text-sm text-muted">
            Asking a question sends the gift list to the assistant. Nothing is sent until you ask.
          </p>
        </div>
      </div>
    </Sheet>
  );
}