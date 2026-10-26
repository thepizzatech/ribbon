import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useOverlay } from "@/components/overlay";
import { Button } from "@/components/ui";
import { personCounts, type Person } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

export function PeoplePage() {
  const people = useLedger((state) => state.people);
  const gifts = useLedger((state) => state.gifts);
  const { open } = useOverlay();
  const household = people.filter((person) => person.circle === "household");
  const outside = people.filter((person) => person.circle === "outside");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">People</h1>
          <p className="mt-1 text-sm text-muted">Who gives, and who receives.</p>
        </div>
        <div className="actions">
          <Button pill onClick={() => open({ type: "person", id: null })}>
            <Plus size={15} strokeWidth={1.75} />
            Add person
          </Button>
        </div>
      </div>
      <Section title="Household" people={household} gifts={gifts} />
      <Section title="Everyone else" people={outside} gifts={gifts} />
    </div>
  );
}

function Section({
  title,
  people,
  gifts,
}: {
  title: string;
  people: Person[];
  gifts: Parameters<typeof personCounts>[0];
}) {
  return (
    <section className="mb-6">
      <h2 className="section-title" style={{ marginTop: 0 }}>
        {title}
      </h2>
      {people.length === 0 ? (
        <p className="text-sm text-muted">No one here yet.</p>
      ) : (
        <ul className="people-grid stagger m-0 list-none p-0">
          {people.map((person) => {
            const counts = personCounts(gifts, person.id);
            return (
              <li key={person.id}>
                <Link to="/people/$personId" params={{ personId: person.id }} className="person-card">
                  <span className="avatar" aria-hidden="true">
                    {initialsOf(person.name)}
                  </span>
                  <span className="meta">
                    <span className="name">{person.name}</span>
                    <span className="rel">{person.role || title}</span>
                  </span>
                  <span className="counts tnum">
                    Gave <b>{counts.gave}</b>
                    <br />
                    Got <b>{counts.got}</b>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
