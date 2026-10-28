import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Cake, CalendarDays, Gift as GiftIcon, Heart, MapPin, PartyPopper, Plus, Shuffle, Sparkles, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useOverlay } from "@/components/overlay";
import { Button, DateField, Field, Sheet, Switch, TextArea, TextInput } from "@/components/ui";
import { plural } from "@/lib/format";
import { stagger } from "@/lib/motion";
import { dateLabel, daysBetween, fromIso, timeLabel } from "@/lib/calendar/dates";
import type { CalEvent, ManualInput } from "@/lib/calendar/types";
import { xapi } from "@/lib/gifts/api-extra";
import { useLedger } from "@/lib/gifts/store";
import { daysLabel } from "@/lib/gifts/upcoming";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICON = { birthday: Cake, anniversary: Heart, occasion: PartyPopper, gift: GiftIcon, santa: Shuffle, manual: CalendarDays, external: CalendarDays } as const;
export const SOURCE_LABEL = { birthday: "Birthday", anniversary: "Anniversary", occasion: "Occasion", gift: "Gift deadline", santa: "Secret Santa", manual: "Your event", external: "Imported" } as const;

// On a phone, focusing the title on open raises the keyboard over half the sheet.
const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

const short = (iso: string) => fromIso(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Right-hand panel: what is coming up, gift deadlines and the main actions. */
export function SidePanel({ upcoming, today, onOpen, onAddEvent, intro }: { upcoming: CalEvent[]; today: string; onOpen: (e: CalEvent) => void; onAddEvent: () => void; intro: boolean }) {
  const { open } = useOverlay();
  const coming = upcoming.filter((e) => e.source === "birthday" || e.source === "anniversary" || e.source === "occasion" || e.source === "santa").slice(0, 5);
  const deadlines = upcoming.filter((e) => e.source === "gift").slice(0, 3);
  const items = coming.length + deadlines.length;
  let n = 0;
  const row = (e: CalEvent) => {
    const Icon = ICON[e.source];
    const i = n++;
    const day = e.start.slice(0, 10);
    return (
      <li key={e.id} className={intro ? "rise" : undefined} style={{ animationDelay: `${stagger(i, Math.max(items, 2), intro)}ms` }}>
        <button type="button" className="cp-row" onClick={() => onOpen(e)}>
          <span className={cn("cp-chip", `tone-${e.tone}`)}>
            <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="cp-t">
              {e.title}
              {e.turning ? <span className="cp-sub"> · {e.source === "birthday" ? `turns ${e.turning}` : plural(e.turning, "year")}</span> : null}
            </span>
            <span className="cp-s">
              {short(day)} · {daysLabel(daysBetween(today, day))}
            </span>
            {e.toBuy && e.toBuy.length > 0 ? <span className="cp-need">Needs a gift: {e.toBuy.slice(0, 2).map((t) => t.name.split(" ")[0]).join(", ")}{e.toBuy.length > 2 ? ` +${e.toBuy.length - 2}` : ""}</span> : null}
          </span>
        </button>
      </li>
    );
  };
  return (
    <aside className="cal-panel" aria-label="Coming up">
      <button type="button" className="cp-primary press" data-tour="add-idea" onClick={() => open({ type: "gift", id: null, direction: "given" })}>
        <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        Add gift idea
      </button>
      <section className="cp-card" aria-labelledby="cp-coming">
        <h2 id="cp-coming" className="cp-h">
          Coming up
        </h2>
        {coming.length === 0 ? <p className="cp-empty">Nothing in the next 45 days. Add birthdays on a person, or connect a calendar in Settings.</p> : <ul className="cp-list">{coming.map(row)}</ul>}
      </section>
      <section className="cp-card" aria-labelledby="cp-deadlines">
        <h2 id="cp-deadlines" className="cp-h">
          Gift deadlines
        </h2>
        {deadlines.length === 0 ? <p className="cp-empty">No gifts are waiting on a date.</p> : <ul className="cp-list">{deadlines.map(row)}</ul>}
      </section>
      <div className="cp-actions">
        <Link to="/ask" search={{ q: "What should I buy for the next birthday?" }} className="cp-ask press">
          <Sparkles size={15} strokeWidth={1.6} aria-hidden="true" />
          <span>Ask Ribbon what to buy</span>
          <ArrowRight size={14} strokeWidth={1.6} aria-hidden="true" />
        </Link>
        <button type="button" className="cp-ghost press" onClick={onAddEvent}>
          <CalendarDays size={15} strokeWidth={1.6} aria-hidden="true" />
          Add an event
        </button>
      </div>
    </aside>
  );
}

/** Details for one event, with the actions that make sense for it. */
export function EventDetail({ event, onClose, onEdit }: { event: CalEvent | null; onClose: () => void; onEdit: (e: CalEvent) => void }) {
  const { open } = useOverlay();
  const people = useLedger((s) => s.people);
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [event?.id]);
  const remove = useMutation({
    mutationFn: (id: string) => xapi.deleteManualEvent(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["calendar"] });
      toast("Event deleted");
      onClose();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn’t delete that"),
  });
  if (!event) return <Sheet open={false} onOpenChange={() => undefined} title="Event">{null}</Sheet>;
  const person = event.personId ? people.find((p) => p.id === event.personId) : undefined;
  const giftFor = person?.id ?? event.toBuy?.[0]?.personId;
  const Icon = ICON[event.source];
  const closeThen = (fn: () => void) => {
    onClose();
    window.setTimeout(fn, 60);
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={event.title} description={`${dateLabel(event)} · ${timeLabel(event)}`}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="ev-meta">
          <span className={cn("cp-chip", `tone-${event.tone}`)}>
            <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span>{SOURCE_LABEL[event.source]}</span>
          {event.connectionName ? <span className="text-muted wrap-any">· {event.connectionName}</span> : null}
          {event.sharedBy ? <span className="text-muted wrap-any">· shared by {event.sharedBy}</span> : null}
          {event.yearly ? <span className="text-muted">· every year</span> : null}
        </div>
        {person ? (
          <p className="wrap-any text-sm">
            <Users size={14} strokeWidth={1.5} className="mr-1 inline" aria-hidden="true" />
            {person.name}
            {event.turning ? ` · ${event.source === "birthday" ? `turns ${event.turning}` : plural(event.turning, "year")}` : ""}
          </p>
        ) : null}
        {event.location ? (
          <p className="wrap-any text-sm text-muted">
            <MapPin size={14} strokeWidth={1.5} className="mr-1 inline" aria-hidden="true" />
            {event.location}
          </p>
        ) : null}
        {event.toBuy && event.toBuy.length > 0 ? (
          <p className="wrap-any text-sm">
            <b>Still to buy:</b> {event.toBuy.map((t) => t.name).join(", ")}
          </p>
        ) : event.covered ? (
          <p className="text-sm text-muted">Gifts are covered for this one.</p>
        ) : null}
        {event.note ? <p className="wrap-any whitespace-pre-wrap text-sm text-muted">{event.note}</p> : null}
        <div className="flex flex-wrap gap-2">
          {giftFor || event.source === "birthday" || event.source === "anniversary" || event.source === "occasion" ? (
            <Button pill onClick={() => closeThen(() => open({ type: "gift", id: null, direction: "given", receiverId: giftFor }))}>
              <Plus size={15} strokeWidth={1.75} />
              Add gift idea
            </Button>
          ) : null}
          {event.giftId ? (
            <Button variant="secondary" pill onClick={() => closeThen(() => open({ type: "gift", id: event.giftId! }))}>
              <GiftIcon size={15} strokeWidth={1.5} />
              Open the gift
            </Button>
          ) : null}
          {person ? (
            <Link to="/people/$personId" params={{ personId: person.id }} className="btn btn-secondary btn-pill press" onClick={onClose}>
              Go to {person.name.split(" ")[0]}
              <ArrowRight size={14} strokeWidth={1.5} />
            </Link>
          ) : null}
          {event.source === "santa" ? (
            <Link to="/santa" className="btn btn-secondary btn-pill press" onClick={onClose}>
              Open Secret Santa
            </Link>
          ) : null}
          {event.source === "external" ? (
            <Link to="/settings" search={{ tab: "calendars" }} className="btn btn-ghost btn-pill press" onClick={onClose}>
              Calendar settings
            </Link>
          ) : null}
        </div>
        {event.manualId && event.canEdit ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="secondary" pill onClick={() => onEdit(event)}>
              Edit
            </Button>
            {confirm ? (
              <Button variant="danger" pill onClick={() => remove.mutate(event.manualId!)} disabled={remove.isPending}>
                Really delete
              </Button>
            ) : (
              <Button variant="ghost" pill onClick={() => setConfirm(true)}>
                <Trash2 size={14} strokeWidth={1.5} />
                Delete
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

const blank = (date: string): ManualInput => ({ title: "", date, allDay: true, startTime: "09:00", endTime: "10:00", personId: null, yearly: false, shared: false, notes: "" });

/** Create or edit your own event. */
export function ManualForm({ open, editing, date, onClose }: { open: boolean; editing: CalEvent | null; date: string; onClose: () => void }) {
  const people = useLedger((s) => s.people);
  const client = useQueryClient();
  const [draft, setDraft] = useState<ManualInput>(blank(date));
  const [error, setError] = useState("");
  const id = editing?.manualId ?? null;
  useEffect(() => {
    if (!open) return;
    setError("");
    if (editing) {
      const timed = !editing.allDay;
      setDraft({
        title: editing.title,
        date: editing.start.slice(0, 10),
        allDay: editing.allDay,
        startTime: timed ? editing.start.slice(11, 16) : "09:00",
        endTime: timed && editing.end ? editing.end.slice(11, 16) : "10:00",
        personId: editing.personId,
        yearly: editing.yearly === true,
        shared: editing.shared === true,
        notes: editing.note ?? "",
      });
    } else setDraft(blank(date));
  }, [open, editing, date]);
  const save = useMutation({
    mutationFn: () => {
      const body: ManualInput = { ...draft, title: draft.title.trim(), personId: draft.personId || null, startTime: draft.allDay ? null : draft.startTime, endTime: draft.allDay ? null : draft.endTime };
      // a yearly event shows its occurrence date here, so only send the date when it was changed
      if (id && editing && draft.date === editing.start.slice(0, 10)) {
        const { date: _unchanged, ...patch } = body;
        void _unchanged;
        return xapi.updateManualEvent(id, patch);
      }
      return id ? xapi.updateManualEvent(id, body) : xapi.addManualEvent(body);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["calendar"] });
      toast(id ? "Event updated" : "Event added");
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn’t save that."),
  });
  const set = <K extends keyof ManualInput>(key: K, value: ManualInput[K]) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={id ? "Edit event" : "Add an event"}
      description="Private to you unless you share it with the household."
      footer={
        <>
          {error ? (
            <p className="form-error text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" form="event-form" block disabled={save.isPending}>
            {id ? "Save event" : "Add event"}
          </Button>
        </>
      }
    >
      <form
        id="event-form"
        className="flex flex-col gap-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.title.trim()) return setError("Give the event a title.");
          save.mutate();
        }}
      >
        <Field label="Title">
          <TextInput value={draft.title} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder="Piano recital…" autoComplete="off" autoFocus={!isTouch()} />
        </Field>
        <DateField label="Date" required value={draft.date} onChange={(date) => set("date", date)} />
        <Switch id="allday" label="All day" checked={draft.allDay} onChange={(v) => set("allDay", v)} />
        {!draft.allDay ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <TextInput type="time" value={draft.startTime ?? ""} onChange={(e) => set("startTime", e.target.value)} />
            </Field>
            <Field label="Ends">
              <TextInput type="time" value={draft.endTime ?? ""} onChange={(e) => set("endTime", e.target.value)} />
            </Field>
          </div>
        ) : null}
        <Field label="About a person (optional)">
          <select className="field" value={draft.personId ?? ""} onChange={(e) => set("personId", e.target.value || null)}>
            <option value="">No one in particular</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Switch id="yearly" label="Repeat every year" checked={draft.yearly === true} onChange={(v) => set("yearly", v)} />
        {!editing || editing.canEdit ? <Switch id="shared" label="Share with the household" checked={draft.shared === true} onChange={(v) => set("shared", v)} /> : null}
        <Field label="Notes (optional)">
          <TextArea rows={3} maxLength={1000} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </form>
    </Sheet>
  );
}
