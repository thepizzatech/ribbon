import { useOverlay } from "@/components/overlay";
import { Button } from "@/components/ui";
import { personCounts, type Person } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

export function PeoplePage() {
  const people = useLedger((state) => state.people);
  const gifts = useLedger((state) => state.gifts);
  const { open } = useOverlay();
  const household = people.filter((person) => person.circle === "household");
  const outside = people.filter((person) => person.circle === "outside");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="display text-4xl">People</h1>
          <p className="mt-1 text-muted">Who gives, and who receives.</p>
        </div>
        <Button onClick={() => open({ type: "person", id: null })}>Add</Button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Household" people={household} gifts={gifts} onOpen={(id) => open({ type: "person", id })} />
        <Section title="Everyone else" people={outside} gifts={gifts} onOpen={(id) => open({ type: "person", id })} />
      </div>
    </div>
  );
}

function Section({
  title,
  people,
  gifts,
  onOpen,
}: {
  title: string;
  people: Person[];
  gifts: Parameters<typeof personCounts>[0];
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-muted">{title}</h2>
      {people.length === 0 ? (
        <p className="text-sm text-muted">No one here yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {people.map((person) => {
            const counts = personCounts(gifts, person.id);
            return (
              <li key={person.id}>
                <button type="button" className="gift-row row-main press" onClick={() => onOpen(person.id)}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-left">
                      <span className="block font-medium">{person.name}</span>
                      <span className="mt-1 block text-sm text-muted">{person.role || title}</span>
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums text-muted">
                      Gave {counts.gave}
                      <span className="block">Got {counts.got}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
