import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, DateField, Field, TextInput } from "@/components/ui";
import { useLedger } from "@/lib/gifts/store";
import { setTheme, useTheme } from "@/lib/theme";
import { toast } from "@/lib/toast";

export function GeneralTab() {
  const householdName = useLedger((s) => s.householdName);
  const occasions = useLedger((s) => s.occasions);
  const occasionDates = useLedger((s) => s.occasionDates);
  const setHouseholdName = useLedger((s) => s.setHouseholdName);
  const addOccasion = useLedger((s) => s.addOccasion);
  const renameOccasion = useLedger((s) => s.renameOccasion);
  const removeOccasion = useLedger((s) => s.removeOccasion);
  const setOccasionDate = useLedger((s) => s.setOccasionDate);
  const theme = useTheme();
  const [name, setName] = useState(householdName);
  const [rows, setRows] = useState(occasions);
  const [next, setNext] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setName(householdName), [householdName]);
  useEffect(() => setRows(occasions), [occasions]);

  function add() {
    const result = addOccasion(next);
    if (result.ok) {
      setNext("");
      setMessage("");
    } else setMessage(result.reason);
  }

  return (
    <div className="settings-grid">
      <section className="card stack" aria-labelledby="hh-title">
        <h2 className="card-title" id="hh-title">
          Household
        </h2>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            setHouseholdName(name);
            toast("Household name saved");
          }}
        >
          <Field label="Household name">
            <TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit">Save name</Button>
        </form>
      </section>

      <section className="card stack" aria-labelledby="look-title">
        <h2 className="card-title" id="look-title">
          Appearance
        </h2>
        <div className="segment" role="group" aria-label="Theme">
          <button type="button" className={theme === "light" ? "is-on" : ""} onClick={() => setTheme("light")}>
            Light
          </button>
          <button type="button" className={theme === "dark" ? "is-on" : ""} onClick={() => setTheme("dark")}>
            Dark
          </button>
        </div>
        <p className="text-xs text-muted">Follows your device until you pick one.</p>
      </section>

      <section className="card stack" aria-labelledby="occ-title">
        <div>
          <h2 className="card-title" id="occ-title">
            Occasions
          </h2>
          <p className="card-sub">
            The choices when you log a gift. Give one a yearly date (like 12-25 for Christmas) and it shows up under Upcoming and in your calendar feed.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={index} className="occasion-row">
              <TextInput
                value={row}
                maxLength={60}
                aria-label={`Occasion ${index + 1}`}
                onChange={(e) => setRows((cur) => cur.map((item, i) => (i === index ? e.target.value : item)))}
                onBlur={(e) => {
                  const result = renameOccasion(index, e.currentTarget.value);
                  setMessage(result.ok ? "" : result.reason);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
              <DateField
                mode="month-day"
                compact
                commitOn="blur"
                aria-label={`Yearly date for ${occasions[index] ?? "occasion"}`}
                value={occasionDates[occasions[index] ?? ""] ?? ""}
                onChange={(value) => {
                  const key = occasions[index];
                  if (!key) return;
                  setOccasionDate(key, value || null);
                  setMessage("");
                }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${occasions[index] ?? "occasion"}`}
                onClick={() => {
                  const result = removeOccasion(index);
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
            value={next}
            maxLength={60}
            placeholder="Add an occasion"
            aria-label="New occasion"
            onChange={(e) => setNext(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={add}>
            Add
          </Button>
        </div>
        {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
      </section>
    </div>
  );
}
