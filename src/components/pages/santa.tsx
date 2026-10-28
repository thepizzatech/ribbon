import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Gift, Plus, Shuffle, X } from "lucide-react";
import { useState } from "react";
import { Button, DateField, Field, TextInput } from "@/components/ui";
import { ApiError } from "@/lib/gifts/api";
import { xapi, type Exchange } from "@/lib/gifts/api-extra";
import { formatMoney } from "@/lib/gifts/model";
import { toast } from "@/lib/toast";

const msg = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback);
const today = () => new Date().toISOString().slice(0, 10);

/** Run a change; when the server says it would undo a draw, ask first, then repeat with confirm. */
async function confirmable<T>(run: (confirm: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await run(false);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      if (window.confirm(error.message)) return run(true);
      return null;
    }
    throw error;
  }
}

function NewExchange({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState(today());
  const [budget, setBudget] = useState("");
  const [peek, setPeek] = useState(false);
  const [avoid, setAvoid] = useState(true);
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () => xapi.createExchange({ name, date, budget: budget === "" ? null : Number(budget), organiserPeek: peek, avoidPrevious: avoid }),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ["exchanges"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] }); // the exchange's date is on the Calendar
      onCreated(d.exchange.id);
    },
    onError: (e) => setMessage(msg(e, "Couldn’t create that.")),
  });
  return (
    <form
      className="card stack"
      style={{ maxWidth: 560 }}
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <h2 className="card-title">New Secret Santa</h2>
      <Field label="Name">
        <TextInput value={name} maxLength={80} placeholder="Christmas 2026" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="date-pair">
        <DateField label="Date" required value={date} onChange={setDate} />
        <Field label="Budget per gift" hint="Optional">
          <TextInput type="number" inputMode="decimal" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={avoid} onChange={(e) => setAvoid(e.target.checked)} />
        <span>Avoid repeating last time’s pairs</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={peek} onChange={(e) => setPeek(e.target.checked)} />
        <span>
          I want to see everyone’s match (the organiser peek). Leave off to be surprised too. People without a login only learn their match if this is on.
        </span>
      </label>
      {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
      <div className="flex gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          Create
        </Button>
      </div>
    </form>
  );
}

function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["exchanges"], queryFn: xapi.exchanges });
  const cands = useQuery({ queryKey: ["exchange-candidates"], queryFn: xapi.candidates });
  const ex = list.data?.exchanges.find((e) => e.id === id);
  const [revealed, setRevealed] = useState(false);
  const [message, setMessage] = useState("");
  const [pairA, setPairA] = useState("");
  const [pairB, setPairB] = useState("");

  const swap = (next: Exchange) =>
    queryClient.setQueryData(["exchanges"], (old: { exchanges: Exchange[] } | undefined) => (old ? { exchanges: old.exchanges.map((e) => (e.id === next.id ? next : e)) } : old));
  const run = useMutation({
    mutationFn: (fn: () => Promise<{ exchange: Exchange } | null>) => fn(),
    onSuccess: (d) => {
      if (d) swap(d.exchange);
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
      setMessage("");
    },
    onError: (e) => setMessage(msg(e, "That didn’t work.")),
  });

  if (!ex) return <p className="text-sm text-muted">{list.isLoading ? "Loading…" : "That exchange isn’t available."}</p>;

  const names = new Map(ex.participants.map((p) => [p.personId, p.name]));
  const inIds = ex.participants.map((p) => p.personId);
  const pairKeys = new Map<string, [string, string]>();
  for (const x of ex.exclusions ?? []) {
    const key = [x.giverId, x.receiverId].sort().join("|");
    if (!pairKeys.has(key)) pairKeys.set(key, [x.giverId, x.receiverId]);
  }
  const pairs = [...pairKeys.values()];
  const drawn = ex.status === "drawn";

  async function check() {
    try {
      const r = await xapi.checkExchange(ex!.id);
      setMessage(r.ok ? "Looks good. There’s a valid draw." : `${r.detail ?? "That setup can’t be drawn."}${r.stuck?.length ? ` (${r.stuck.join(", ")})` : ""}`);
    } catch (error) {
      setMessage(msg(error, "Couldn’t check."));
    }
  }

  const households = [...new Set((cands.data?.people ?? []).map((p) => p.householdName))];

  return (
    <div className="stack santa-detail">
      <button type="button" className="btn btn-ghost press" style={{ alignSelf: "flex-start" }} onClick={onBack}>
        <ArrowLeft size={15} strokeWidth={1.5} /> All exchanges
      </button>
      <div>
        <h2 className="page-title" style={{ fontSize: "1.5rem" }}>
          {ex.name}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {new Date(`${ex.date}T12:00`).toLocaleDateString(undefined, { dateStyle: "long" })}
          {ex.budget !== null ? ` · budget ${formatMoney(ex.budget)}` : ""} · organised by {ex.organiser.isMe ? "you" : ex.organiser.name} ({ex.organiser.householdName})
        </p>
      </div>

      <div className="santa-cards">
        {drawn && ex.youAreIn ? (
          <section className="reveal" aria-label="Your match">
            {revealed && ex.mine ? (
              <>
                <p>You’re giving to</p>
                <p className="name" role="status">
                  {ex.mine.name}
                </p>
                <p style={{ opacity: 0.85 }}>{ex.mine.householdName}</p>
                {ex.mine.householdId ? (
                  <p style={{ marginTop: 10 }}>
                    <Link to="/shared" style={{ color: "inherit", textDecoration: "underline" }}>
                      See their wishlist
                    </Link>
                  </p>
                ) : null}
                <button type="button" className="btn press" style={{ marginTop: 14 }} onClick={() => setRevealed(false)}>
                  Hide
                </button>
              </>
            ) : (
              <>
                <p>The names are drawn.</p>
                <p className="name">Ready to see who you’ve got?</p>
                <button type="button" className="btn press" style={{ marginTop: 14 }} onClick={() => setRevealed(true)} disabled={!ex.mine}>
                  Reveal my match
                </button>
                <p style={{ marginTop: 10, fontSize: "0.8125rem", opacity: 0.85 }}>Make sure no one is looking over your shoulder.</p>
              </>
            )}
          </section>
        ) : null}
        {drawn && !ex.youAreIn ? (
          <p className="notice">
            Names are drawn. {ex.canManage ? "You aren’t in this exchange, so you can’t see anyone’s match unless the organiser peek is on." : ""}
          </p>
        ) : null}
        {ex.assignments ? (
          <section className="card stack" aria-labelledby="peek-title">
            <h3 className="card-title" id="peek-title">
              Everyone’s match (organiser view)
            </h3>
            <ul className="m-0 list-none p-0">
              {ex.assignments.map((a) => (
                <li className="kv" key={a.giver}>
                  <span>{a.giver}</span>
                  <span className="text-muted">gives to {a.receiver}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card stack" aria-labelledby="who-title">
          <h3 className="card-title" id="who-title">
            Who’s in ({ex.participants.length})
          </h3>
          {ex.canManage ? (
            <div className="stack">
              {households.map((h) => (
                <fieldset key={h} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="lbl">{h}</legend>
                  <div className="santa-people">
                    {(cands.data?.people ?? [])
                      .filter((p) => p.householdName === h)
                      .map((p) => (
                        <label className="check" key={p.personId}>
                          <input
                            type="checkbox"
                            checked={inIds.includes(p.personId)}
                            onChange={(e) => {
                              const next = e.target.checked ? [...inIds, p.personId] : inIds.filter((x) => x !== p.personId);
                              run.mutate(() => confirmable((c) => xapi.setParticipants(ex.id, next, c)));
                            }}
                          />
                          <span>
                            {p.name}
                            <span className="sub block text-xs text-muted">{p.hasLogin ? "Has a login" : "No login"}</span>
                          </span>
                        </label>
                      ))}
                  </div>
                </fieldset>
              ))}
              <p className="text-xs text-muted">People need a login to see their own match, unless you turn on the organiser peek. People from linked households appear once they’re shared.</p>
            </div>
          ) : (
            <ul className="santa-people m-0 list-none p-0">
              {ex.participants.map((p) => (
                <li key={p.personId}>
                  {p.name}
                  {p.isMe ? " (you)" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        {ex.canManage ? (
          <section className="card stack" aria-labelledby="ex-title">
            <div>
              <h3 className="card-title" id="ex-title">
                Who shouldn’t draw each other
              </h3>
              <p className="card-sub">For couples, say. Neither will get the other.</p>
            </div>
            <ul className="m-0 list-none p-0">
              {pairs.map(([a, b]) => (
                <li className="kv" key={`${a}${b}`}>
                  <span>
                    {names.get(a) ?? "?"} and {names.get(b) ?? "?"}
                  </span>
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={`Remove the rule for ${names.get(a)} and ${names.get(b)}`}
                    onClick={() =>
                      run.mutate(() =>
                        confirmable((c) =>
                          xapi.setExclusions(ex.id, pairs.filter(([x, y]) => !(x === a && y === b)), c),
                        ),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="wish-form-row">
              <label className="lbl">
                Person
                <span className="select-wrap">
                  <select className="field" value={pairA} onChange={(e) => setPairA(e.target.value)}>
                    <option value="">Choose</option>
                    {ex.participants.map((p) => (
                      <option key={p.personId} value={p.personId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="lbl">
                and
                <span className="select-wrap">
                  <select className="field" value={pairB} onChange={(e) => setPairB(e.target.value)}>
                    <option value="">Choose</option>
                    {ex.participants
                      .filter((p) => p.personId !== pairA)
                      .map((p) => (
                        <option key={p.personId} value={p.personId}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </span>
              </label>
            </div>
            <Button
              variant="secondary"
              disabled={!pairA || !pairB || pairA === pairB}
              onClick={() => {
                run.mutate(() => confirmable((c) => xapi.setExclusions(ex.id, [...pairs, [pairA, pairB]], c)));
                setPairA("");
                setPairB("");
              }}
            >
              Add rule
            </Button>
          </section>
        ) : null}

        {ex.canManage ? (
          <section className="card stack" aria-labelledby="draw-title">
            <h3 className="card-title" id="draw-title">
              {drawn ? `Drawn ${ex.drawCount === 1 ? "once" : `${ex.drawCount} times`}` : "Draw the names"}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void check()}>
                Check it works
              </Button>
              <Button
                onClick={() => {
                  setRevealed(false);
                  run.mutate(async () => {
                    const r = await confirmable((c) => xapi.drawExchange(ex.id, c));
                    if (r) toast(drawn ? "Drawn again" : "Names drawn");
                    return r;
                  });
                }}
                disabled={ex.participants.length < 2 || run.isPending}
              >
                <Shuffle size={15} strokeWidth={1.5} /> {drawn ? "Draw again" : "Draw names"}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm(`Delete ${ex.name}? The draw is lost.`)) {
                    void xapi.deleteExchange(ex.id).then(() => {
                      void queryClient.invalidateQueries({ queryKey: ["exchanges"] });
                      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
                      onBack();
                    });
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </section>
        ) : null}
      </div>
      {message ? (
        <p className="text-sm" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function SantaPage() {
  const list = useQuery({ queryKey: ["exchanges"], queryFn: xapi.exchanges });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const exchanges = list.data?.exchanges ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Secret Santa</h1>
          <p className="mt-1 text-sm text-muted">Draw names for the family, with rules for couples. Each person reveals their own match.</p>
        </div>
        {!selected && !creating ? (
          <div className="actions">
            <Button pill onClick={() => setCreating(true)}>
              <Plus size={15} strokeWidth={1.75} /> New exchange
            </Button>
          </div>
        ) : null}
      </div>
      {creating ? (
        <NewExchange
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
          }}
        />
      ) : selected ? (
        <Detail id={selected} onBack={() => setSelected(null)} />
      ) : exchanges.length === 0 ? (
        <section className="card empty" style={{ maxWidth: 560 }}>
          <span className="empty-art">
            <Gift size={26} strokeWidth={1.5} />
          </span>
          <h2 className="card-title" style={{ fontSize: "1.25rem" }}>
            No exchanges yet
          </h2>
          <p className="text-muted">Start one, pick who’s in, and draw. Everyone with a login can reveal their own match privately.</p>
          <div>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} strokeWidth={1.75} /> New exchange
            </Button>
          </div>
        </section>
      ) : (
        <ul className="card-grid m-0 list-none p-0">
          {exchanges.map((e) => (
            <li key={e.id}>
              <button type="button" className="card santa-card press" style={{ width: "100%", textAlign: "left" }} onClick={() => setSelected(e.id)}>
                <span className="card-title block">{e.name}</span>
                <span className="card-sub block">
                  {new Date(`${e.date}T12:00`).toLocaleDateString(undefined, { dateStyle: "medium" })} · {e.participants.length} people ·{" "}
                  {e.status === "drawn" ? "Drawn" : "Not drawn yet"}
                  {e.youAreIn ? " · You’re in" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
