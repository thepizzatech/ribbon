import type { CSSProperties } from "react";
import { formatMoney } from "@/lib/gifts/model";
import type { Breakdown } from "@/lib/gifts/insights";

type Month = { label: string; full: string; received: number; given: number };

/** Stacked hatched bars per month (given below, received on top). No grid or axes; hover or focus a bar for details. */
export function MonthChart({ series, hot, target }: { series: Month[]; hot: number; target: number | null }) {
  const totals = series.map((row) => row.received + row.given);
  const top = Math.max(1, ...totals, target ?? 0) * 1.18;
  const pct = (value: number) => `${(value / top) * 100}%`;
  return (
    <div className="mchart">
      <div className="mchart-bars">
        {series.map((row, index) => {
          const total = totals[index] ?? 0;
          const isHot = index === hot;
          const summary = `${row.full}: ${row.received} received, ${row.given} given`;
          return (
            <div
              key={row.full}
              className={isHot ? "mcol is-hot" : "mcol"}
              tabIndex={0}
              role="img"
              aria-label={summary}
              style={{ "--i": index } as CSSProperties}
            >
              {total > 0 ? (
                <div className="mbar" style={{ height: pct(total) }}>
                  {row.given > 0 ? <span className="mseg-out" style={{ flexBasis: pct(row.given), flexGrow: row.given }} /> : null}
                  {row.received > 0 ? <span className="mseg-in" style={{ flexBasis: pct(row.received), flexGrow: row.received }} /> : null}
                  {isHot ? <span className="mvalue">{total}</span> : null}
                </div>
              ) : null}
              <span className="tip" aria-hidden="true">
                {row.full} · {row.received} received · {row.given} given
              </span>
            </div>
          );
        })}
      </div>
      {target != null && target > 0 ? (
        <div className="mtarget" style={{ bottom: `calc(22px + (100% - 22px) * ${target / top})` }} aria-hidden="true">
          <span>Last year’s monthly average</span>
        </div>
      ) : null}
      <div className="mlabels" aria-hidden="true">
        {series.map((row, index) => (
          <span key={row.full} className={index === hot ? "is-hot" : undefined}>
            {row.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function fmt(unit: Breakdown["unit"], value: number) {
  return unit === "usd" ? (formatMoney(value) ?? "$0") : `${value} ${value === 1 ? "gift" : "gifts"}`;
}

/** Build-up waterfall: each row floats where the last one ended; the solid blue bar is the total. */
export function Waterfall({ data }: { data: Breakdown }) {
  let start = 0;
  const max = data.total || 1;
  return (
    <div className="wf" role="list">
      {data.rows.map((row, index) => {
        const left = (start / max) * 100;
        const width = Math.max(1.5, (row.value / max) * 100);
        start += row.value;
        return (
          <div className="wf-row" key={row.label} role="listitem">
            <span className="wf-label" title={row.label}>
              {row.label}
            </span>
            <span className="wf-track" aria-hidden="true">
              <span className="wf-bar" style={{ left: `${left}%`, width: `${width}%`, "--i": index } as CSSProperties} />
            </span>
            <span className="wf-value">
              +{fmt(data.unit, row.value)}
              {data.unit === "usd" ? ` · ${row.count}` : ""}
            </span>
          </div>
        );
      })}
      <div className="wf-row" role="listitem">
        <span className="wf-label">Total</span>
        <span className="wf-track" aria-hidden="true">
          <span className="wf-bar is-total" style={{ left: 0, width: "100%", "--i": data.rows.length } as CSSProperties} />
        </span>
        <span className="wf-value is-total">{fmt(data.unit, data.total)}</span>
      </div>
    </div>
  );
}
