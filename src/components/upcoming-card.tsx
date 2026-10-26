import { Link } from "@tanstack/react-router";
import { Cake, CalendarDays, Check, Heart, PartyPopper } from "lucide-react";
import { useMemo } from "react";
import { useLedger } from "@/lib/gifts/store";
import { daysLabel, upcoming, type Upcoming } from "@/lib/gifts/upcoming";
import { useMyPersonId } from "@/lib/gifts/use-session";

const ICON = { birthday: Cake, anniversary: Heart, occasion: PartyPopper } as const;

function when(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Row({ event }: { event: Upcoming }) {
  const Icon = ICON[event.kind];
  const done = event.toBuy.length === 0 && event.covered > 0;
  const body = (
    <>
      <span className={`tone-chip ${event.kind === "birthday" ? "tone-rose" : event.kind === "anniversary" ? "tone-warn" : "tone-out"}`}>
        <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="t">
          {event.title}
          {event.turning ? <span className="text-muted font-normal"> · {event.kind === "birthday" ? `turns ${event.turning}` : `${event.turning} years`}</span> : null}
        </span>
        <span className="s">
          {when(event.date)} · {daysLabel(event.daysLeft)}
        </span>
        {event.toBuy.length > 0 ? (
          <span className="s up-buy">
            To buy: {event.toBuy.slice(0, 3).map((t) => t.name.split(" ")[0]).join(", ")}
            {event.toBuy.length > 3 ? ` +${event.toBuy.length - 3} more` : ""}
          </span>
        ) : null}
      </span>
      {done ? (
        <span className="pill pill-in up-done">
          <Check size={12} strokeWidth={2} aria-hidden="true" /> Bought
        </span>
      ) : null}
    </>
  );
  return event.personId ? (
    <Link to="/people/$personId" params={{ personId: event.personId }} className="need-main">
      {body}
    </Link>
  ) : (
    <Link to="/people" className="need-main">
      {body}
    </Link>
  );
}

/** The next 60 days: birthdays, anniversaries and yearly occasions, with what is still to buy. */
export function UpcomingCard() {
  const people = useLedger((s) => s.people);
  const gifts = useLedger((s) => s.gifts);
  const occasionDates = useLedger((s) => s.occasionDates);
  const me = useMyPersonId();
  const events = useMemo(() => upcoming({ people, gifts, occasionDates, mePersonId: me, days: 60 }), [people, gifts, occasionDates, me]);
  return (
    <section className="card" aria-labelledby="upcoming-title" data-tour="upcoming">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="upcoming-title">
            Upcoming
          </h2>
          <p className="card-sub">Next 60 days</p>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted">
          <CalendarDays size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          Nothing in the next 60 days. Add birthdays on a person and a date for each occasion in Settings.
        </p>
      ) : (
        <ul className="need-list stagger">
          {events.slice(0, 6).map((event) => (
            <li className="need" key={event.key}>
              <Row event={event} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
