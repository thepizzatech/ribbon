import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, TextInput } from "@/components/ui";
import { xapi, type Budget } from "@/lib/gifts/api-extra";
import { formatMoney, personName, type Gift, type Person } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";
import { toast } from "@/lib/toast";

/** What has been spent (bought or given) and what is only planned (ideas with a price), for gifts you gave. */
export function spendFor(gifts: Gift[], year: number, match: (gift: Gift) => boolean) {
  let spent = 0;
  let planned = 0;
  for (const gift of gifts) {
    if (gift.direction !== "given" || !gift.date.startsWith(`${year}-`) || !match(gift)) continue;
    if (gift.status === "idea") planned += gift.amount ?? 0;
    else spent += gift.amount ?? 0;
  }
  return { spent, planned };
}

export function BudgetBar({ spent, planned, budget, label }: { spent: number; planned: number; budget: number; label: string }) {
  const total = spent + planned;
  const over = total > budget && budget > 0;
  const spentPct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const plannedPct = budget > 0 ? Math.min(100 - spentPct, (planned / budget) * 100) : 0;
  return (
    <div className="budget-bar">
      <div
        className={`budget-track${over ? " is-over" : ""}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={Math.min(total, budget)}
        aria-valuetext={`${formatMoney(spent) ?? "$0"} spent${planned > 0 ? `, ${formatMoney(planned)} planned` : ""} of ${formatMoney(budget)}`}
      >
        <span className="budget-spent" style={{ width: `${spentPct}%` }} />
        <span className="budget-planned" style={{ width: `${plannedPct}%` }} />
      </div>
      <p className="budget-text">
        <b>{formatMoney(spent) ?? "$0"}</b> of {formatMoney(budget)}
        {planned > 0 ? ` · ${formatMoney(planned)} planned` : ""}
        {over ? (
          <span className="budget-flag"> · {formatMoney(total - budget)} over</span>
        ) : (
          <span> · {formatMoney(Math.max(0, budget - total))} left</span>
        )}
      </p>
    </div>
  );
}

function useBudgets(year: number) {
  return useQuery({ queryKey: ["budgets", year], queryFn: () => xapi.budgets(year) });
}

function useSetBudget(year: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { scope: "person" | "occasion"; key: string; amount: number | null }) => xapi.setBudget({ ...input, year }),
    onSuccess: (data) => queryClient.setQueryData(["budgets", year], data),
    onError: () => toast("Couldn’t save that budget."),
  });
}

function BudgetEdit({ initial, label, onSave, onCancel }: { initial: number | null; label: string; onSave: (amount: number | null) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  return (
    <form
      className="budget-edit"
      onSubmit={(event) => {
        event.preventDefault();
        const n = value.trim() === "" ? null : Number(value.replace(/[^0-9.]/g, ""));
        onSave(n === null || Number.isNaN(n) ? null : n);
      }}
    >
      <TextInput autoFocus inputMode="decimal" aria-label={label} placeholder="Amount" value={value} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" small>
        Save
      </Button>
      <Button type="button" small variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** Per-person budget for the year, on that person's page. Hidden on your own page: it's a surprise too. */
export function PersonBudget({ person, year }: { person: Person; year: number }) {
  const gifts = useLedger((s) => s.gifts);
  const data = useBudgets(year);
  const set = useSetBudget(year);
  const [editing, setEditing] = useState(false);
  const budget = data.data?.budgets.find((b) => b.scope === "person" && b.key === person.id)?.amount ?? null;
  const { spent, planned } = useMemo(() => spendFor(gifts, year, (g) => g.receiverId === person.id), [gifts, year, person.id]);
  return (
    <section className="card" aria-labelledby="pb-title" data-tour="budget">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="pb-title">
            Budget for {year}
          </h2>
          <p className="card-sub">Bought or given to {person.name.split(" ")[0]} this year</p>
        </div>
        {!editing ? (
          <Button variant="secondary" pill small onClick={() => setEditing(true)}>
            <Pencil size={13} strokeWidth={1.5} />
            {budget === null ? "Set" : "Edit"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <BudgetEdit
          initial={budget}
          label={`Budget for ${person.name}`}
          onCancel={() => setEditing(false)}
          onSave={(amount) => {
            set.mutate({ scope: "person", key: person.id, amount });
            setEditing(false);
          }}
        />
      ) : budget !== null ? (
        <BudgetBar spent={spent} planned={planned} budget={budget} label={`Spending on ${person.name}`} />
      ) : (
        <p className="mt-3 text-sm text-muted">
          {spent > 0 ? `${formatMoney(spent)} so far. ` : ""}No budget set yet.
        </p>
      )}
    </section>
  );
}

/** Overview card: occasion budgets and any person budgets, with spend against each. */
export function BudgetsCard({ year }: { year: number }) {
  const gifts = useLedger((s) => s.gifts);
  const people = useLedger((s) => s.people);
  const occasions = useLedger((s) => s.occasions);
  const data = useBudgets(year);
  const set = useSetBudget(year);
  const [editing, setEditing] = useState<string | null>(null);
  const budgets: Budget[] = data.data?.budgets ?? [];
  const byOccasion = (name: string) => budgets.find((b) => b.scope === "occasion" && b.key === name)?.amount ?? null;
  const personBudgets = budgets.filter((b) => b.scope === "person");
  const rows = occasions.filter((o) => byOccasion(o) !== null || editing === o);

  return (
    <section className="card" aria-labelledby="budgets-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="budgets-title">
            Budgets
          </h2>
          <p className="card-sub">Spend against budget in {year}</p>
        </div>
      </div>
      {data.isLoading ? <p className="mt-3 text-sm text-muted">Loading…</p> : null}
      <ul className="budget-list">
        {rows.map((name) => {
          const amount = byOccasion(name);
          const { spent, planned } = spendFor(gifts, year, (g) => g.occasion === name);
          return (
            <li key={`o-${name}`}>
              <div className="budget-row-head">
                <span className="font-medium">{name}</span>
                <button type="button" className="text-link" onClick={() => setEditing(editing === name ? null : name)}>
                  {editing === name ? "Close" : "Edit"}
                </button>
              </div>
              {editing === name ? (
                <BudgetEdit
                  initial={amount}
                  label={`${name} budget`}
                  onCancel={() => setEditing(null)}
                  onSave={(next) => {
                    set.mutate({ scope: "occasion", key: name, amount: next });
                    setEditing(null);
                  }}
                />
              ) : amount !== null ? (
                <BudgetBar spent={spent} planned={planned} budget={amount} label={`${name} spending`} />
              ) : null}
            </li>
          );
        })}
        {personBudgets.map((b) => {
          const { spent, planned } = spendFor(gifts, year, (g) => g.receiverId === b.key);
          return (
            <li key={`p-${b.key}`}>
              <div className="budget-row-head">
                <Link to="/people/$personId" params={{ personId: b.key }} className="font-medium hover:underline">
                  {personName(people, b.key)}
                </Link>
              </div>
              <BudgetBar spent={spent} planned={planned} budget={b.amount} label={`${personName(people, b.key)} spending`} />
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && personBudgets.length === 0 && !data.isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Wallet size={16} strokeWidth={1.5} aria-hidden="true" /> Set a budget for an occasion or a person to see progress here.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {occasions.filter((o) => byOccasion(o) === null && editing !== o).length > 0 ? (
          <label className="pill-select">
            <select
              aria-label="Add an occasion budget"
              value=""
              onChange={(e) => {
                if (e.target.value) setEditing(e.target.value);
              }}
            >
              <option value="">Add an occasion budget…</option>
              {occasions.filter((o) => byOccasion(o) === null && editing !== o).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="text-xs text-muted">Person budgets are set on each person’s page.</p>
      </div>
    </section>
  );
}
