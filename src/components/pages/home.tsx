import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useOverlay } from "@/components/overlay";
import { Button } from "@/components/ui";
import {
  formatDate,
  formatMoney,
  monthSeries,
  personName,
  recentDelivered,
  statusLabel,
  yearStats,
  yearsOf,
} from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

export function HomePage() {
  const gifts = useLedger((state) => state.gifts);
  const people = useLedger((state) => state.people);
  const demo = useLedger((state) => state.demo);
  const demoDismissed = useLedger((state) => state.demoDismissed);
  const dismissDemo = useLedger((state) => state.dismissDemo);
  const clearLedger = useLedger((state) => state.clearLedger);
  const updateGift = useLedger((state) => state.updateGift);
  const setListFocus = useLedger((state) => state.setListFocus);
  const { open } = useOverlay();
  const years = yearsOf(gifts);
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked != null && years.includes(picked) ? picked : (years[0] ?? 2026);
  const stats = yearStats(gifts, year);
  const planned = stats.open.filter((gift) => gift.date.startsWith(`${year}-`));
  const thanks = stats.thanks.filter((gift) => gift.date.startsWith(`${year}-`));
  const series = monthSeries(gifts, year);
  const recent = recentDelivered(gifts);
  const spent = formatMoney(stats.spent);
  const inYear = gifts.filter((gift) => gift.date.startsWith(`${year}-`));
  const receivedGifts = inYear.filter((gift) => gift.direction === "received");
  const thankedCount = receivedGifts.filter((gift) => gift.thanked).length;
  const thankRate = receivedGifts.length === 0 ? 0 : Math.round((thankedCount / receivedGifts.length) * 100);
  const peak = Math.max(stats.received, stats.given, planned.length, thanks.length, 1);
  const monthMax = Math.max(1, ...series.map((row) => Math.max(row.received, row.given)));
  const yearTotal = stats.received + stats.given;

  return (
    <div className="flex flex-col gap-4">
      <div className="dash-head">
        <div>
          <h1 className="display text-3xl text-foreground">Overview</h1>
          <p className="mt-1 text-sm text-muted">Gifts in and out for {year}.</p>
        </div>
        {years.length > 0 ? (
          <div className="year-switch" role="group" aria-label="Year">
            {years.map((item) => (
              <button
                key={item}
                type="button"
                className={item === year ? "year is-on" : "year"}
                onClick={() => setPicked(item)}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {demo && !demoDismissed ? (
        <aside className="panel flex flex-col gap-3">
          <div>
            <p className="font-medium">Sample household</p>
            <p className="text-sm text-muted">
              Avery, Jordan, and a few gifts are here so you can try the ledger and Ask. Clear them when you want your own.
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

      {gifts.length === 0 ? (
        <section className="panel flex flex-col items-start gap-3">
          <h2 className="display text-2xl">Nothing logged yet</h2>
          <p className="text-muted">Add the people you exchange gifts with, then record what came in and what went out.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => open({ type: "gift", id: null, direction: "received" })}>Log a gift</Button>
            <Button variant="secondary" onClick={() => open({ type: "person", id: null })}>
              Add a person
            </Button>
          </div>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="stat-grid">
            <Kpi label="Received" hint="this year" value={stats.received} max={peak} tone="in" note="Gifts that came in" />
            <Kpi label="Given" hint="this year" value={stats.given} max={peak} tone="out" note={spent ? `${spent} recorded` : "Nothing recorded yet"} />
            <Kpi label="Still to give" hint="open" value={planned.length} max={peak} tone="ink" note="Ideas and gifts already bought" />
            <Kpi label="Thank-yous" hint="waiting" value={thanks.length} max={peak} tone="in" note={receivedGifts.length ? `${thankRate}% already sent` : "No gifts received"} />
          </div>

          <div className="metric-strip">
            <div className="metric-cell">
              <p className="text-sm text-muted">Logged</p>
              <p className="metric-num">{yearTotal}</p>
              <p className="kpi-note">Gifts in {year}</p>
            </div>
            <div className="metric-cell">
              <p className="text-sm text-muted">Spent</p>
              <p className="metric-num">{spent ?? "—"}</p>
              <p className="kpi-note">Recorded on gifts given</p>
            </div>
            <div className="metric-cell">
              <p className="text-sm text-muted">Thank-yous sent</p>
              <p className="metric-num">
                {thankedCount}
                <span className="text-sm font-medium text-muted"> / {receivedGifts.length}</span>
              </p>
              <p className="kpi-note">Of gifts received in {year}</p>
            </div>
            <div className="metric-cell">
              <p className="text-sm text-muted">People</p>
              <p className="metric-num">{people.length}</p>
              <p className="kpi-note">In this household ledger</p>
            </div>
          </div>

          <div className="home-grid">
            <section className="panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-muted">By month</h2>
                  <p className="stat-value mt-2">{yearTotal}</p>
                </div>
                <p className="mt-3 flex items-center gap-3 text-sm text-muted">
                  <span className="inline-flex items-center gap-2">
                    <span className="swatch swatch-in" /> Received
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="swatch swatch-out" /> Given
                  </span>
                </p>
              </div>
              <Trend series={series} max={monthMax} />
              <div className="month-labels" aria-hidden="true">
                {series.map((row) => (
                  <span key={row.full}>{row.full}</span>
                ))}
              </div>
              <ul className="sr-only">
                {series.map((row) => (
                  <li key={row.full}>
                    {row.full}: {row.received} received, {row.given} given
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <h2 className="text-sm font-medium text-muted">Where it stands</h2>
              <div className="mt-4">
                <Move label="Received" value={stats.received} max={peak} tone="in" />
                <Move label="Given" value={stats.given} max={peak} tone="out" />
                <Move label="Still to give" value={planned.length} max={peak} tone="ink" />
                <Move label="Thank-yous waiting" value={thanks.length} max={peak} tone="in" />
              </div>
            </section>
          </div>

          <div className="home-grid">
            <section className="panel">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium">Still to give</h2>
                {planned.length > 0 ? (
                  <Link to="/ledger" className="text-link" onClick={() => setListFocus("open")}>
                    See all
                  </Link>
                ) : null}
              </div>
              {planned.length === 0 ? (
                <p className="text-sm text-muted">No planned gifts waiting.</p>
              ) : (
                <ul className="flex flex-col">
                  {planned.slice(0, 4).map((gift) => (
                    <li key={gift.id} className="border-t border-border py-3 first:border-t-0 first:pt-0">
                      <button type="button" className="w-full text-left" onClick={() => open({ type: "gift", id: gift.id })}>
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block font-medium">{gift.title}</span>
                            <span className="mt-1 block text-sm text-muted">
                              {personName(people, gift.receiverId)} · {gift.occasion}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm text-muted">{statusLabel(gift.status)}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="row-action press mt-2"
                        onClick={() => updateGift(gift.id, { status: "delivered" })}
                      >
                        Mark given
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium">Recent</h2>
                {thanks.length > 0 ? (
                  <Link to="/ledger" className="text-link" onClick={() => setListFocus("thanks")}>
                    Thank-yous
                  </Link>
                ) : null}
              </div>
              {recent.length === 0 ? (
                <p className="text-sm text-muted">Gifts that have already changed hands show up here.</p>
              ) : (
                <ul className="flex flex-col">
                  {recent.map((gift) => (
                    <li key={gift.id} className="border-t border-border first:border-t-0">
                      <button type="button" className="flex w-full items-start gap-3 py-3 text-left" onClick={() => open({ type: "gift", id: gift.id })}>
                        <span className={gift.direction === "given" ? "activity-dot is-out" : "activity-dot"} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{gift.title}</span>
                          <span className="mt-0.5 block text-sm text-muted">
                            {personName(people, gift.giverId)} to {personName(people, gift.receiverId)} · {formatDate(gift.date)}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-muted">{formatMoney(gift.amount)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {thanks.length > 0 ? (
                <div className="mt-2 border-t border-border pt-3">
                  <p className="text-sm text-muted">
                    {thanks.length === 1 ? "1 thank-you still open." : `${thanks.length} thank-yous still open.`}
                  </p>
                  <button
                    type="button"
                    className="row-action press mt-2"
                    onClick={() => updateGift(thanks[0].id, { thanked: true })}
                  >
                    Mark {thanks[0].title} thanked
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Every received gift has a thank-you.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  hint,
  value,
  max,
  tone,
  note,
}: {
  label: string;
  hint: string;
  value: number;
  max: number;
  tone: "in" | "out" | "ink";
  note: string;
}) {
  const width = max <= 0 ? 0 : Math.max(value > 0 ? 8 : 0, Math.round((value / max) * 100));
  return (
    <article className="panel">
      <p className="kpi-label">
        {label}
        <span>{hint}</span>
      </p>
      <p className="stat-value mt-2">{value}</p>
      <div className="meter" aria-hidden="true">
        <span className={tone === "ink" ? "meter-fill" : `meter-fill is-${tone}`} style={{ width: `${width}%` }} />
      </div>
      <p className="kpi-note">{note}</p>
    </article>
  );
}

function Move({ label, value, max, tone }: { label: string; value: number; max: number; tone: "in" | "out" | "ink" }) {
  const width = max <= 0 ? 0 : Math.max(value > 0 ? 8 : 0, Math.round((value / max) * 100));
  return (
    <div className="move-row">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div className="meter" aria-hidden="true">
        <span className={tone === "ink" ? "meter-fill" : `meter-fill is-${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Trend({
  series,
  max,
}: {
  series: { label: string; full: string; received: number; given: number }[];
  max: number;
}) {
  const width = 640;
  const height = 196;
  const padLeft = 28;
  const padTop = 12;
  const plotH = height - padTop;
  const groupW = (width - padLeft) / series.length;
  const barW = Math.min(10, groupW * 0.28);
  const mid = Math.round(max / 2);
  const ticks = mid > 0 && mid < max ? [max, mid, 0] : [max, 0];
  const yAt = (value: number) => padTop + plotH - (value / max) * (plotH - 2);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trend mt-2" role="img" aria-hidden="true">
      {ticks.map((tick) => {
        const y = yAt(tick);
        return (
          <g key={tick}>
            <line className="trend-grid" x1={padLeft} x2={width} y1={y} y2={y} />
            <text className="trend-tick" x="0" y={y + 4}>
              {tick}
            </text>
          </g>
        );
      })}
      {series.map((row, index) => {
        const center = padLeft + groupW * index + groupW / 2;
        const receivedH = row.received === 0 ? 0 : Math.max(3, (row.received / max) * (plotH - 2));
        const givenH = row.given === 0 ? 0 : Math.max(3, (row.given / max) * (plotH - 2));
        return (
          <g key={row.full}>
            <title>{`${row.full}: ${row.received} received, ${row.given} given`}</title>
            <rect
              className="trend-bar-in"
              x={center - barW - 1.5}
              y={padTop + plotH - receivedH}
              width={barW}
              height={receivedH}
              rx="2"
            />
            <rect
              className="trend-bar-out"
              x={center + 1.5}
              y={padTop + plotH - givenH}
              width={barW}
              height={givenH}
              rx="2"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function GiftSummary({
  title,
  meta,
  aside,
  direction,
}: {
  title: string;
  meta: string;
  aside: string | null;
  direction: "received" | "given";
}) {
  return (
    <span className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className={direction === "received" ? "pill pill-in" : "pill pill-out"}>
            {direction === "received" ? "Received" : "Given"}
          </span>
          <span className="font-medium">{title}</span>
        </span>
        <span className="mt-1 block text-sm text-muted">{meta}</span>
      </span>
      {aside ? <span className="shrink-0 text-sm tabular-nums text-muted">{aside}</span> : null}
    </span>
  );
}
