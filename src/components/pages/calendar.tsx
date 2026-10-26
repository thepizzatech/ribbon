import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { MonthGrid, TimeGrid } from "@/components/calendar/grid";
import { EventDetail, ManualForm, SidePanel, SOURCE_LABEL } from "@/components/calendar/side";
import { CountUp } from "@/components/motion";
import { useIntro } from "@/lib/motion";
import { addDays, daysOf, rangeLabel, rangeOf, step, titleOf, todayLocal, type View } from "@/lib/calendar/dates";
import type { CalEvent } from "@/lib/calendar/types";
import { xapi } from "@/lib/gifts/api-extra";
import { useLedger } from "@/lib/gifts/store";
import { cn } from "@/lib/utils";

const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];
const AVATAR_TONES = ["purple", "pink", "red", "blue", "green", "amber"] as const;
const initials = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? (p[p.length - 1]?.[0] ?? "") : "")).toUpperCase();
};

export function CalendarPage() {
  const today = todayLocal();
  const people = useLedger((s) => s.people);
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState(today); // the day shown on a phone
  const [who, setWho] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [form, setForm] = useState<{ open: boolean; editing: CalEvent | null }>({ open: false, editing: null });

  const range = rangeOf(view, anchor);
  const events = useQuery({
    queryKey: ["calendar", "events", range.from, range.to],
    queryFn: () => xapi.calEvents(range.from, range.to, today),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({ queryKey: ["calendar", "summary", today], queryFn: () => xapi.calSummary(today) });
  const soon = useQuery({ queryKey: ["calendar", "events", today, addDays(today, 45)], queryFn: () => xapi.calEvents(today, addDays(today, 45), today) });
  const intro = useIntro(events.isSuccess);

  const all = useMemo(() => events.data?.events ?? [], [events.data]);
  const sources = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of all) {
      if (e.source === "external") seen.set(`conn:${e.connectionId}`, e.connectionName ?? "Imported");
      else seen.set(`src:${e.source}`, SOURCE_LABEL[e.source] + (e.source === "birthday" || e.source === "gift" ? "s" : ""));
    }
    return [...seen.entries()];
  }, [all]);
  const shown = useMemo(
    () =>
      all.filter((e) => {
        if (who.size > 0 && !(e.personId && who.has(e.personId))) return false;
        return !hidden.has(e.source === "external" ? `conn:${e.connectionId}` : `src:${e.source}`);
      }),
    [all, who, hidden],
  );
  // a stable order for the staggered fade-in: by start time, then title
  const order = useMemo(() => {
    const m = new Map<string, number>();
    [...shown].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)).forEach((e, i) => m.set(e.id, i));
    return m;
  }, [shown]);
  const days = useMemo(() => {
    if (view === "month") return [];
    const out: string[] = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [view, range.from, range.to]);
  const weekHasPicked = days.includes(picked) ? picked : days.includes(today) ? today : (days[0] ?? today);
  const inRange = shown.filter((e) => daysOf(e, range.from, range.to).length > 0).length;

  const filterPeople = people.filter((p) => p.circle === "household").concat(people.filter((p) => p.circle !== "household")).slice(0, 8);
  const go = (dir: 1 | -1) => {
    const next = step(view, anchor, dir);
    setAnchor(next);
    setPicked(next);
  };
  const toToday = () => {
    setAnchor(today);
    setPicked(today);
  };
  const s = summary.data;
  const nb = (soon.data?.events ?? []).find((e) => e.source === "birthday");
  const nextBirthday = nb ? `Next: ${nb.title.replace(/[’']s birthday$/i, "")} · ${new Date(nb.start.slice(0, 10) + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : s ? "None coming up" : " ";

  return (
    <div className="cal-page" data-view={view}>
      <header className="cal-head">
        <div className="min-w-0">
          <h1 className="cal-title">{titleOf(view, anchor, today)}</h1>
          <p className="cal-range">{rangeLabel(view, anchor)}</p>
        </div>
        <div className="cal-tools">
          <div className="cal-nav" role="group" aria-label="Move">
            <button type="button" className="cal-pill press" onClick={toToday} disabled={view === "day" ? anchor === today : range.from <= today && today <= range.to}>
              Today
            </button>
            <button type="button" className="cal-round press" aria-label={`Previous ${view}`} onClick={() => go(-1)}>
              <ChevronLeft size={16} strokeWidth={1.6} />
            </button>
            <button type="button" className="cal-round press" aria-label={`Next ${view}`} onClick={() => go(1)}>
              <ChevronRight size={16} strokeWidth={1.6} />
            </button>
          </div>
          <div className="cal-seg" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={view === v.id} className={cn(view === v.id && "is-on")} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <button type="button" className="cal-add press" data-tour="add-event" onClick={() => setForm({ open: true, editing: null })}>
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
            <span>Event</span>
          </button>
        </div>
      </header>

      <div className="cal-filters">
        <div className="cal-avatars" role="group" aria-label="Show events about">
          {filterPeople.map((p, i) => {
            const on = who.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={cn("cal-av", `tone-${AVATAR_TONES[i % AVATAR_TONES.length]}`, on && "is-on")}
                aria-pressed={on}
                title={p.name}
                aria-label={p.name}
                onClick={() => setWho((cur) => (cur.has(p.id) ? new Set([...cur].filter((x) => x !== p.id)) : new Set([...cur, p.id])))}
              >
                {initials(p.name)}
              </button>
            );
          })}
        </div>
        {sources.length > 1 ? (
          <div className="cal-sources" role="group" aria-label="Show these kinds of events">
            {sources.map(([key, label]) => {
              const on = !hidden.has(key);
              return (
                <button key={key} type="button" className={cn("cal-src", on && "is-on")} aria-pressed={on} onClick={() => setHidden((cur) => (cur.has(key) ? new Set([...cur].filter((x) => x !== key)) : new Set([...cur, key])))}>
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="cal-layout">
        <div className="cal-main">
          <div className="cal-kpis" data-tour="cal-kpis">
            <Kpi label="Events this week" value={s?.eventsThisWeek ?? 0} note={s ? (s.todayCount > 0 ? `${s.todayCount} today` : "Nothing today") : " "} />
            <Kpi label="Birthdays in 30 days" value={s?.birthdaysIn30 ?? 0} note={nextBirthday} />
            <Kpi label="Gifts still needed" value={s?.giftsNeeded ?? 0} note={s && s.giftEventsNeeded > 0 ? `for ${s.giftEventsNeeded} ${s.giftEventsNeeded === 1 ? "event" : "events"}` : "All covered"} />
          </div>

          <section className="cal-card" aria-label="Calendar" aria-busy={events.isFetching}>
            {view === "month" ? (
              <MonthGrid
                from={range.from}
                anchor={anchor}
                events={shown}
                today={today}
                intro={intro}
                indexOf={order}
                total={shown.length}
                onOpen={setDetail}
                onPickDay={(d) => {
                  setView("day");
                  setAnchor(d);
                  setPicked(d);
                }}
              />
            ) : (
              <TimeGrid days={days} events={shown} today={today} picked={weekHasPicked} onPick={setPicked} onOpen={setDetail} intro={intro} indexOf={order} total={shown.length} />
            )}
            {events.isError ? <p className="cal-note">Couldn’t load events. Try again in a moment.</p> : null}
            {events.isSuccess && inRange === 0 ? <p className="cal-note">Nothing here{who.size || hidden.size ? " with these filters" : ""}. Add an event, or connect a calendar in Settings.</p> : null}
          </section>
        </div>
        <SidePanel upcoming={soon.data?.events ?? []} today={today} onOpen={setDetail} onAddEvent={() => setForm({ open: true, editing: null })} intro={intro} />
      </div>

      <EventDetail
        event={detail}
        onClose={() => setDetail(null)}
        onEdit={(e) => {
          setDetail(null);
          setForm({ open: true, editing: e });
        }}
      />
      <ManualForm open={form.open} editing={form.editing} date={view === "day" ? anchor : today} onClose={() => setForm({ open: false, editing: null })} />
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="cal-kpi">
      <p className="cal-kpi-label">{label}</p>
      <p className="cal-kpi-num">
        <CountUp value={value} />
      </p>
      <p className="cal-kpi-note">{note}</p>
    </div>
  );
}
