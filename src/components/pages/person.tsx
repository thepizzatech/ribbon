import { Link } from "@tanstack/react-router";
import { ChevronLeft, Pencil, Plus } from "lucide-react";
import { PersonBudget } from "@/components/budgets";
import { Waterfall } from "@/components/charts";
import { WishlistSection } from "@/components/wishlist";
import { useOverlay } from "@/components/overlay";
import { initialsOf } from "@/components/pages/people";
import { StatusDot } from "@/components/pages/ledger";
import { Button } from "@/components/ui";
import { personOccasions } from "@/lib/gifts/insights";
import { formatDate, formatMoney, giftsForPerson, personName } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";
import { useMyPersonId } from "@/lib/gifts/use-session";
import { formatMonthDay } from "@/lib/gifts/upcoming";

export function PersonPage({ personId }: { personId: string }) {
  const people = useLedger((state) => state.people);
  const gifts = useLedger((state) => state.gifts);
  const { open } = useOverlay();
  const person = people.find((item) => item.id === personId);
  const me = useMyPersonId();

  if (!person) {
    return (
      <section className="card empty" style={{ maxWidth: 520 }}>
        <h1 className="card-title" style={{ fontSize: "1.25rem" }}>
          That person is gone
        </h1>
        <p className="text-muted">They may have been removed.</p>
        <Link to="/people" className="btn btn-primary">
          Back to People
        </Link>
      </section>
    );
  }

  const history = giftsForPerson(gifts, person.id);
  const gave = history.filter((gift) => gift.giverId === person.id);
  const got = history.filter((gift) => gift.receiverId === person.id);
  const spentOn = got.reduce((sum, gift) => sum + (gift.direction === "given" ? (gift.amount ?? 0) : 0), 0);
  const owed = gave.filter((gift) => gift.direction === "received" && !gift.thanked).length;
  const occasions = personOccasions(gifts, person.id);

  const byYear = new Map<string, typeof history>();
  for (const gift of history) {
    const year = gift.date.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), gift]);
  }

  return (
    <div>
      <Link to="/people" className="back-link">
        <ChevronLeft size={15} strokeWidth={1.5} aria-hidden="true" />
        People
      </Link>
      <div className="person-head">
        <span className="avatar is-lg" aria-hidden="true">
          {initialsOf(person.name)}
        </span>
        <div className="who">
          <h1 className="page-title">{person.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {person.role || "No relationship set"} · {person.circle === "household" ? "In your household" : "Outside the household"}
            {me === person.id ? " · This is you" : ""}
          </p>
          {person.birthday || person.anniversary ? (
            <p className="mt-1 text-sm text-muted">
              {person.birthday ? `Birthday ${formatMonthDay(person.birthday)}` : ""}
              {person.birthday && person.anniversary ? " · " : ""}
              {person.anniversary ? `Anniversary ${formatMonthDay(person.anniversary)}` : ""}
            </p>
          ) : null}
        </div>
        <div className="actions flex gap-2">
          <Button variant="secondary" pill onClick={() => open({ type: "person", id: person.id })}>
            <Pencil size={14} strokeWidth={1.5} />
            Edit
          </Button>
          <Button
            pill
            onClick={() => open({ type: "gift", id: null, direction: "given", receiverId: person.id })}
          >
            <Plus size={15} strokeWidth={1.75} />
            Log gift
          </Button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <p className="label">Gave</p>
          <p className="value">{gave.length}</p>
        </div>
        <div className="kpi">
          <p className="label">Got</p>
          <p className="value">{got.length}</p>
        </div>
        <div className="kpi">
          <p className="label">Spent on them</p>
          <p className="value">{spentOn > 0 ? formatMoney(spentOn) : "—"}</p>
        </div>
        <div className="kpi">
          <p className="label">Thank-yous owed</p>
          <p className="value">{owed}</p>
        </div>
      </div>

      <div className="detail-grid" style={{ marginBottom: 16 }}>
        <WishlistSection personId={person.id} personName={person.name} isSelf={me === person.id} />
        {me === person.id ? null : <PersonBudget person={person} year={new Date().getFullYear()} />}
      </div>

      {history.length === 0 ? (
        <section className="card empty">
          <h2 className="card-title">No gifts yet</h2>
          <p className="text-muted">Gifts {person.name} gave or got will build a timeline here.</p>
        </section>
      ) : (
        <div className="detail-grid">
          <section className="card" aria-labelledby="occ-title">
            <h2 className="card-title" id="occ-title">
              By occasion
            </h2>
            <p className="card-sub">Gifts they gave or got</p>
            <Waterfall data={occasions} />
          </section>
          <section className="card" aria-labelledby="tl-title">
            <h2 className="card-title" id="tl-title">
              Timeline
            </h2>
            <ol className="timeline">
              {[...byYear.entries()].map(([year, items]) => (
                <li key={year} className="contents">
                  <p className="year">{year}</p>
                  <ul className="m-0 list-none p-0">
                    {items.map((gift) => {
                      const gaveIt = gift.giverId === person.id;
                      const other = personName(people, gaveIt ? gift.receiverId : gift.giverId);
                      return (
                        <li key={gift.id} className={gift.direction === "received" ? "t-item is-received" : "t-item"}>
                          <button type="button" className="t-btn" onClick={() => open({ type: "gift", id: gift.id })}>
                            <span>
                              <span className="t">{gift.title}</span>
                              <span className="s">
                                {gaveIt ? `Gave to ${other}` : `Got from ${other}`} · {gift.occasion} · {formatDate(gift.date)}
                              </span>
                            </span>
                            <span className="r">
                              <span className="text-sm">{formatMoney(gift.amount) ?? ""}</span>
                              <StatusDot gift={gift} />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
