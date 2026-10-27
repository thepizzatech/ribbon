import { Cake, Gift as GiftIcon, Heart, PartyPopper, Shuffle } from "lucide-react";
import { useMemo } from "react";
import { addDays, daysOf, fromIso, hourLabel, parseWhen, placeDay, timeLabel, type View } from "@/lib/calendar/dates";
import { firstGrapheme, plural } from "@/lib/format";
import { stagger } from "@/lib/motion";
import type { CalEvent } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

const HOUR = 52; // px per hour
const MIN_EVENT_W = 60; // px: overlapping events never get narrower than this; the day scrolls sideways instead
const ALL_DAY_CAP = 3; // all-day chips per day before "+N more"
const SOURCE_ICON = { birthday: Cake, anniversary: Heart, occasion: PartyPopper, gift: GiftIcon, santa: Shuffle } as const;

function EventIcon({ event }: { event: CalEvent }) {
  const Icon = SOURCE_ICON[event.source as keyof typeof SOURCE_ICON];
  return Icon ? <Icon size={11} strokeWidth={1.75} aria-hidden="true" className="ev-icon" /> : null;
}

function describe(e: CalEvent) {
  return `${e.title}, ${timeLabel(e)}${e.connectionName ? `, from ${e.connectionName}` : ""}`;
}

type Common = { onOpen: (e: CalEvent) => void; intro: boolean };

const rise = (intro: boolean) => (intro ? "rise" : undefined);
const longDay = (iso: string) => fromIso(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

function dayHead(day: string, today: string) {
  const d = fromIso(day);
  return { weekday: d.toLocaleDateString(undefined, { weekday: "short" }), num: d.getDate(), isToday: day === today };
}

export function TimeGrid({ days, events, today, now, picked, onPick, onOpenDay, onOpen, intro, indexOf, total }: Common & { days: string[]; events: CalEvent[]; today: string; now: Date; picked: string; onPick: (d: string) => void; onOpenDay: (d: string) => void; indexOf: Map<string, number>; total: number }) {
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>(days.map((d) => [d, []]));
    for (const e of events) for (const d of daysOf(e, days[0]!, days[days.length - 1]!)) map.get(d)?.push(e);
    return map;
  }, [days, events]);
  const placed = useMemo(() => new Map(days.map((d) => [d, placeDay(d, byDay.get(d) ?? [])])), [days, byDay]);

  // show 8:00 to 20:00 unless something falls outside it
  let first = 8;
  let last = 20;
  for (const list of placed.values()) {
    for (const p of list) {
      first = Math.min(first, Math.floor(p.top / 60));
      last = Math.max(last, Math.ceil((p.top + p.height) / 60));
    }
  }
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const pickedIndex = Math.max(0, days.indexOf(picked));

  return (
    <div className="wk" data-days={days.length} data-pick={pickedIndex} role="group" aria-label="Calendar">
      <div className="wk-strip" role="group" aria-label="Day">
        {days.map((d) => {
          const h = dayHead(d, today);
          return (
            <button key={d} type="button" aria-pressed={d === picked} aria-current={h.isToday ? "date" : undefined} className={cn("wk-pill", d === picked && "is-on", h.isToday && "is-today")} onClick={() => onPick(d)}>
              <span aria-hidden="true">{firstGrapheme(h.weekday)}</span>
              <span className="sr-only">{h.weekday}</span>
              <b>{h.num}</b>
            </button>
          );
        })}
      </div>
      <div className="wk-head" aria-hidden="true">
        <span className="wk-gutter" />
        {days.map((d, i) => {
          const h = dayHead(d, today);
          return (
            <div key={d} className={cn("wk-day", h.isToday && "is-today")} data-i={i}>
              <span>{h.weekday}</span>
              <b>{h.num}</b>
            </div>
          );
        })}
      </div>
      <div className="wk-allday">
        <span className="wk-gutter">all-day</span>
        {days.map((d, i) => {
          const allDay = (byDay.get(d) ?? []).filter((e) => e.allDay);
          // one day is a full view: show everything there. A week caps the band so it can't push the hours off screen.
          const shownAll = days.length > 1 ? allDay.slice(0, ALL_DAY_CAP) : allDay;
          return (
            <div key={d} className="wk-allcell" data-i={i}>
              {shownAll.map((e) => (
                <button
                  key={`${e.id}-${d}`}
                  type="button"
                  className={cn("ev ev-all", rise(intro), `tone-${e.tone}`)}
                  style={{ animationDelay: `${stagger(indexOf.get(e.id) ?? 0, total, intro)}ms` }}
                  onClick={() => onOpen(e)}
                  aria-label={describe(e)}
                >
                  <EventIcon event={e} />
                  <span className="truncate">{e.title}</span>
                </button>
              ))}
              {allDay.length > shownAll.length ? (
                <button type="button" className="mo-more" onClick={() => onOpenDay(d)} aria-label={`+${allDay.length - shownAll.length} more, open ${longDay(d)}`}>
                  +{allDay.length - shownAll.length} more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="wk-body">
        <div className="wk-hours" aria-hidden="true">
          {hours.map((h) => (
            <span key={h} style={{ height: HOUR }}>
              {hourLabel(h)}
            </span>
          ))}
        </div>
        {days.map((d, i) => {
          const list = placed.get(d) ?? [];
          const widest = Math.max(1, ...list.map((p) => p.cols));
          return (
            <div key={d} className={cn("wk-col", d === today && "is-today")} role="group" aria-label={longDay(d)} data-i={i} style={{ height: hours.length * HOUR }}>
              <div className="wk-lane" style={{ minWidth: widest > 1 ? widest * MIN_EVENT_W : undefined }}>
                {d === today && nowMin >= first * 60 && nowMin <= last * 60 ? <span className="wk-now" style={{ top: ((nowMin - first * 60) / 60) * HOUR }} aria-hidden="true" /> : null}
                {list.map((p) => {
                  const short = p.height < 44;
                  return (
                    <button
                      key={`${p.event.id}-${d}`}
                      type="button"
                      className={cn("ev", rise(intro), `tone-${p.event.tone}`, short && "is-short")}
                      style={{
                        top: ((p.top - first * 60) / 60) * HOUR + 1,
                        height: (p.height / 60) * HOUR - 2,
                        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                        animationDelay: `${stagger(indexOf.get(p.event.id) ?? 0, total, intro)}ms`,
                      }}
                      onClick={() => onOpen(p.event)}
                      aria-label={describe(p.event)}
                    >
                      <span className="ev-title">
                        <EventIcon event={p.event} />
                        <span className="truncate">{p.event.title}</span>
                      </span>
                      {!short ? <span className="ev-time">{timeLabel(p.event)}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MonthGrid({ from, anchor, events, today, onOpen, onPickDay, intro, indexOf, total }: Common & { from: string; anchor: string; events: CalEvent[]; today: string; onPickDay: (d: string) => void; indexOf: Map<string, number>; total: number }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>(days.map((d) => [d, []]));
    for (const e of events) for (const d of daysOf(e, days[0]!, days[41]!)) map.get(d)?.push(e);
    for (const list of map.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || parseWhen(a.start).getTime() - parseWhen(b.start).getTime());
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, events]);
  const month = anchor.slice(0, 7);
  return (
    <div className="mo" role="group" aria-label="Month">
      {days.slice(0, 7).map((d) => (
        <div key={d} className="mo-dow" aria-hidden="true">
          {fromIso(d).toLocaleDateString(undefined, { weekday: "short" })}
        </div>
      ))}
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        const shown = list.slice(0, 3);
        return (
          <div key={d} className={cn("mo-cell", d.slice(0, 7) !== month && "is-out", d === today && "is-today")}>
            <button type="button" className="mo-num" onClick={() => onPickDay(d)} aria-label={`${longDay(d)}, ${plural(list.length, "event")}`}>
              {fromIso(d).getDate()}
            </button>
            <div className="mo-list">
              {shown.map((e) => (
                <button
                  key={`${e.id}-${d}`}
                  type="button"
                  className={cn("ev ev-mo", rise(intro), `tone-${e.tone}`)}
                  style={{ animationDelay: `${stagger(indexOf.get(e.id) ?? 0, total, intro)}ms` }}
                  onClick={() => onOpen(e)}
                  aria-label={describe(e)}
                >
                  <span className="truncate">{e.title}</span>
                </button>
              ))}
              {list.length > 3 ? (
                <button type="button" className="mo-more" onClick={() => onPickDay(d)}>
                  +{list.length - 3} more
                </button>
              ) : null}
            </div>
            <span className="mo-dots" aria-hidden="true">
              {list.slice(0, 4).map((e) => (
                <i key={`${e.id}-${d}`} className={`tone-${e.tone}`} />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export type { View };
