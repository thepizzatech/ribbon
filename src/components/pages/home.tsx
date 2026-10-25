import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Gift as GiftIcon,
  HeartHandshake,
  Lightbulb,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { BudgetsCard } from "@/components/budgets";
import { MonthChart, Waterfall } from "@/components/charts";
import { UpcomingCard } from "@/components/upcoming-card";
import { useOverlay } from "@/components/overlay";
import { Button } from "@/components/ui";
import { downloadLedger } from "@/lib/gifts/export";
import {
  breakdown,
  computeInsights,
  delta,
  needsYou,
  yearTotals,
  type Delta,
} from "@/lib/gifts/insights";
import { formatDate, formatMoney, monthSeries, personName, yearsOf } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";
import { toast } from "@/lib/toast";

function DeltaPill({ value, suffix = "" }: { value: Delta | null; suffix?: string }) {
  if (!value) return null;
  const Icon = value.dir === "up" ? ArrowUpRight : value.dir === "down" ? ArrowDownRight : Minus;
  return (
    <span className={`delta is-${value.dir}`} title="Compared with last year">
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      {value.label}
      {suffix}
    </span>
  );
}

export function HomePage() {
  const gifts = useLedger((state) => state.gifts);
  const people = useLedger((state) => state.people);
  const householdName = useLedger((state) => state.householdName);
  const occasions = useLedger((state) => state.occasions);
  const demo = useLedger((state) => state.demo);
  const demoDismissed = useLedger((state) => state.demoDismissed);
  const dismissDemo = useLedger((state) => state.dismissDemo);
  const clearLedger = useLedger((state) => state.clearLedger);
  const updateGift = useLedger((state) => state.updateGift);
  const setListFocus = useLedger((state) => state.setListFocus);
  const { open } = useOverlay();
  const navigate = useNavigate();

  const thisYear = new Date().getFullYear();
  const years = useMemo(() => {
    const set = new Set([...yearsOf(gifts), thisYear]);
    return [...set].sort((a, b) => b - a);
  }, [gifts, thisYear]);
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked != null && years.includes(picked) ? picked : (yearsOf(gifts)[0] ?? thisYear);
  const [by, setBy] = useState<"occasion" | "person">("occasion");
  const [step, setStep] = useState(0);

  const totals = yearTotals(gifts, year);
  const last = yearTotals(gifts, year - 1);
  const needs = needsYou(gifts, people);
  const series = monthSeries(gifts, year);
  const lastSeries = monthSeries(gifts, year - 1);
  const lastAvg = last.total > 0 ? last.total / 12 : null;
  const hot = year === thisYear ? new Date().getMonth() : series.reduce((best, row, i, all) => (row.received + row.given > (all[best]!.received + all[best]!.given) ? i : best), 0);
  const split = breakdown(gifts, people, year, by);
  const insights = useMemo(() => computeInsights(gifts, people, year), [gifts, people, year]);
  const insight = insights[insights.length ? step % insights.length : 0];
  const spent = formatMoney(totals.spent);
  const lastSpent = formatMoney(last.spent);
  void lastSeries;

  const header = (
    <div className="page-head">
      <div>
        <h1 className="page-title">Overview</h1>
        <p className="mt-1 text-sm text-muted">{householdName}</p>
      </div>
      <div className="actions">
        <label className="pill-select">
          <CalendarDays size={15} strokeWidth={1.5} aria-hidden="true" />
          <select aria-label="Year" value={year} onChange={(event) => setPicked(Number(event.target.value))}>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
        </label>
        <span className="hidden text-xs text-muted sm:inline">vs {year - 1}</span>
        <Button
          variant="secondary"
          pill
          onClick={() => {
            downloadLedger({ householdName, people, gifts, occasions });
            toast("Ledger exported");
          }}
        >
          <Download size={15} strokeWidth={1.5} />
          Export
        </Button>
        <Button pill data-tour="add-gift" onClick={() => open({ type: "gift", id: null })}>
          <Plus size={15} strokeWidth={1.75} />
          Log gift
        </Button>
      </div>
    </div>
  );

  if (gifts.length === 0) {
    return (
      <div>
        {header}
        <section className="card empty" style={{ maxWidth: 560 }} data-tour="hero">
          <span className="empty-art">
            <GiftIcon size={26} strokeWidth={1.5} />
          </span>
          <h2 className="card-title" style={{ fontSize: "1.25rem" }}>
            Nothing logged yet
          </h2>
          <p className="text-muted">
            Record what your household gives and receives. Thank-yous and gifts still to buy will show up here so nothing slips.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => open({ type: "gift", id: null, direction: "received" })}>
              <Plus size={16} strokeWidth={1.75} />
              Add your first gift
            </Button>
            <Button variant="secondary" onClick={() => open({ type: "person", id: null })}>
              <Users size={16} strokeWidth={1.5} />
              Add a person
            </Button>
          </div>
        </section>
        <div style={{ maxWidth: 560, marginTop: 16 }}>
          <UpcomingCard />
        </div>
      </div>
    );
  }

  const needItems = [
    ...needs.thanks.slice(0, 3).map((gift) => ({
      gift,
      tone: "tone-in",
      icon: HeartHandshake,
      title: `Thank ${personName(people, gift.giverId)}`,
      sub: `${gift.title} · ${formatDate(gift.date)}`,
      action: "Thanked",
      done: () => updateGift(gift.id, { thanked: true }),
    })),
    ...needs.bought.slice(0, 2).map((gift) => ({
      gift,
      tone: "tone-out",
      icon: ShoppingBag,
      title: `Give ${gift.title}`,
      sub: `Bought · for ${personName(people, gift.receiverId)} · ${formatDate(gift.date)}`,
      action: "Given",
      done: () => updateGift(gift.id, { status: "delivered" }),
    })),
    ...needs.toGive.slice(0, 2).map((gift) => ({
      gift,
      tone: "tone-warn",
      icon: Lightbulb,
      title: gift.title,
      sub: `Idea · for ${personName(people, gift.receiverId)} · ${formatDate(gift.date)}`,
      action: "Bought",
      done: () => updateGift(gift.id, { status: "purchased" }),
    })),
  ].slice(0, 6);

  return (
    <div>
      {header}

      {demo && !demoDismissed ? (
        <aside className="card mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Sample household</p>
            <p className="text-sm text-muted">
              Avery, Jordan, and a few gifts are here so you can try Ribbon. Clear them when you want your own.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={clearLedger}>
              Clear sample
            </Button>
            <Button variant="ghost" onClick={dismissDemo}>
              Keep for now
            </Button>
          </div>
        </aside>
      ) : null}

      <div className="dash-grid">
        <div className="dash-col">
          <section className="card" aria-labelledby="hero-title" data-tour="hero">
            <h2 className="card-title" id="hero-title">
              Gifts this year
            </h2>
            <p className="card-sub">
              {year} · received and given
            </p>
            <p className="hero-num mt-6">{totals.total}</p>
            <div className="hero-row">
              <DeltaPill value={delta(totals.total, last.total)} />
              <span className="text-xs text-muted">
                {last.total > 0 ? `vs ${last.total} in ${year - 1}` : `First year logged`}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted">
              {totals.received} received and {totals.given} given
              {spent && totals.spent > 0 ? `, ${spent} spent on gifts you gave` : ""}.
            </p>
            {totals.thankRate != null ? (
              <>
                <div className="progress" aria-hidden="true">
                  <span className="progress-fill" style={{ width: `${Math.max(totals.thankRate, 2)}%` }} />
                  {last.thankRate != null ? (
                    <span className="progress-marker" style={{ left: `${last.thankRate}%` }} />
                  ) : null}
                </div>
                <div className="progress-legend">
                  <span>Thank-yous sent {totals.thankRate}%</span>
                  {last.thankRate != null ? <span>Last year {last.thankRate}%</span> : null}
                </div>
              </>
            ) : null}
            <div className="stat-rows">
              <div className="stat-row">
                Received
                <span className="end">
                  <b>{totals.received}</b>
                  <DeltaPill value={delta(totals.received, last.received)} />
                </span>
              </div>
              <div className="stat-row">
                Given
                <span className="end">
                  <b>{totals.given}</b>
                  <DeltaPill value={delta(totals.given, last.given)} />
                </span>
              </div>
              <div className="stat-row">
                Spent
                <span className="end">
                  <b>{spent ?? "$0"}</b>
                  <DeltaPill value={delta(totals.spent, last.spent, (n) => formatMoney(n) ?? "")} />
                </span>
              </div>
              <div className="stat-row">
                Thank-yous sent
                <span className="end">
                  <b>
                    {totals.thanked}
                    <span className="text-sm font-normal text-muted"> / {totals.received}</span>
                  </b>
                </span>
              </div>
            </div>
            {lastSpent && last.spent > 0 ? <span className="sr-only">Last year you spent {lastSpent}.</span> : null}
          </section>

          <section className="card" aria-labelledby="months-title">
            <div className="card-head">
              <div>
                <h2 className="card-title" id="months-title">
                  By month
                </h2>
                <p className="card-sub">Gifts in {year}</p>
              </div>
              <p className="legend">
                <span>
                  <i className="out" />
                  Given
                </span>
                <span>
                  <i className="in" />
                  Received
                </span>
              </p>
            </div>
            <MonthChart series={series} hot={hot} target={lastAvg} />
          </section>
        </div>

        <div className="dash-col">
          <UpcomingCard />
          <section className="card" aria-labelledby="split-title">
            <div className="card-head">
              <div>
                <h2 className="card-title" id="split-title">
                  Where it went
                </h2>
                <p className="card-sub">
                  {split.total > 0
                    ? `Gifts given in ${year}, by ${by}`
                    : `No gifts given in ${year} yet`}
                </p>
              </div>
              <div className="segment is-small" role="group" aria-label="Group by">
                <button type="button" className={by === "occasion" ? "is-on" : ""} onClick={() => setBy("occasion")}>
                  Occasion
                </button>
                <button type="button" className={by === "person" ? "is-on" : ""} onClick={() => setBy("person")}>
                  Person
                </button>
              </div>
            </div>
            {split.total > 0 ? (
              <>
                <Waterfall data={split} />
                <div className="note">
                  <p>
                    {split.rows[0]!.label} leads with{" "}
                    {Math.round((split.rows[0]!.value / split.total) * 100)}% of the total.
                  </p>
                  <p>
                    {split.unit === "usd"
                      ? "Dollar amounts come from the gifts you gave."
                      : "Add amounts to gifts to see dollars here."}
                  </p>
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted">Log a gift you gave in {year} and its breakdown appears here.</p>
            )}
          </section>
          <BudgetsCard year={year} />
        </div>

        <div className="dash-col is-wide">
          {insight ? (
            <section className="insight" aria-label="Insight">
              <span className="insight-mesh" aria-hidden="true" />
              <div className="insight-top">
                <span className="insight-pill">
                  <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" />
                  Pattern found
                </span>
                <span className="insight-step">
                  <button type="button" aria-label="Previous pattern" onClick={() => setStep((step + insights.length - 1) % insights.length)}>
                    <ChevronLeft size={14} />
                  </button>
                  {(step % insights.length) + 1} of {insights.length}
                  <button type="button" aria-label="Next pattern" onClick={() => setStep((step + 1) % insights.length)}>
                    <ChevronRight size={14} />
                  </button>
                </span>
              </div>
              <p className="hero-num">
                {insight.big}
                <span className="insight-unit">{insight.unit}</span>
              </p>
              <h3>{insight.headline}</h3>
              <p className="insight-detail">{insight.detail}</p>
              <Link to="/ask" search={{ q: insight.question }} className="insight-cta mt-6">
                Ask about this
                <ArrowRight size={15} strokeWidth={1.75} />
              </Link>
            </section>
          ) : null}

          <section className="card" aria-labelledby="needs-title">
            <div className="card-head">
              <div>
                <h2 className="card-title" id="needs-title">
                  Needs you
                </h2>
                <p className="card-sub">
                  {needs.count === 0 ? "All caught up" : `${needs.count} ${needs.count === 1 ? "thing" : "things"} open`}
                </p>
              </div>
              {needs.count > 0 ? (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setListFocus(needs.thanks.length > 0 ? "thanks" : "open");
                    void navigate({ to: "/ledger", search: {} });
                  }}
                >
                  See all
                </button>
              ) : null}
            </div>
            {needItems.length === 0 ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-muted">
                <Check size={16} strokeWidth={1.75} /> Every received gift has a thank-you and nothing is waiting to be given.
              </p>
            ) : (
              <ul className="need-list">
                {needItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li className="need" key={`${item.action}-${item.gift.id}`}>
                      <button type="button" className="need-main" onClick={() => open({ type: "gift", id: item.gift.id })}>
                        <span className={`tone-chip ${item.tone}`}>
                          <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="t">{item.title}</span>
                          <span className="s">{item.sub}</span>
                        </span>
                        <ChevronRight size={16} strokeWidth={1.5} className="chev" aria-hidden="true" />
                      </button>
                      <Button
                        variant="secondary"
                        small
                        className="need-done"
                        aria-label={`Mark ${item.gift.title} as ${item.action.toLowerCase()}`}
                        title={`Mark as ${item.action.toLowerCase()}`}
                        onClick={item.done}
                      >
                        <Check size={14} strokeWidth={2} />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
