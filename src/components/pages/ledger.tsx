import { useMemo, useState } from "react";
import { GiftSummary } from "@/components/pages/home";
import { useOverlay } from "@/components/overlay";
import { TextInput } from "@/components/ui";
import { formatDate, formatMoney, formatMonth, personName, type Direction } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

export function LedgerPage() {
  const gifts = useLedger((state) => state.gifts);
  const people = useLedger((state) => state.people);
  const focus = useLedger((state) => state.listFocus);
  const setListFocus = useLedger((state) => state.setListFocus);
  const { open } = useOverlay();
  const [direction, setDirection] = useState<Direction | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return gifts
      .filter((gift) => (direction === "all" ? true : gift.direction === direction))
      .filter((gift) => {
        if (focus === "thanks") return gift.direction === "received" && !gift.thanked;
        if (focus === "open") return gift.direction === "given" && gift.status !== "delivered";
        return true;
      })
      .filter((gift) => {
        if (!needle) return true;
        const blob = [
          gift.title,
          gift.occasion,
          gift.note,
          personName(people, gift.giverId),
          personName(people, gift.receiverId),
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(needle);
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  }, [direction, focus, gifts, people, query]);

  const groups: { key: string; label: string; ids: string[] }[] = [];
  for (const gift of filtered) {
    const key = gift.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.ids.push(gift.id);
    else groups.push({ key, label: formatMonth(gift.date), ids: [gift.id] });
  }
  const byId = new Map(filtered.map((gift) => [gift.id, gift]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="display text-4xl">Ledger</h1>
          <p className="mt-1 text-muted">{gifts.length === 1 ? "1 gift" : `${gifts.length} gifts`}</p>
        </div>
      </div>

      <TextInput
        value={query}
        placeholder="Search gifts, people, occasions"
        aria-label="Search gifts"
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="segment cols-3" role="group" aria-label="Direction">
        {(
          [
            ["all", "All"],
            ["received", "Received"],
            ["given", "Given"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={direction === value ? "is-on" : ""}
            onClick={() => setDirection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {focus !== "all" ? (
        <button type="button" className="chip self-start press" onClick={() => setListFocus("all")}>
          {focus === "thanks" ? "Thank-yous only" : "Still to give"} · Clear
        </button>
      ) : null}

      {filtered.length === 0 ? (
        <section className="panel">
          <h2 className="display text-2xl">No gifts match</h2>
          <p className="mt-2 text-muted">Try another search, or log the gift you have in mind.</p>
          <button type="button" className="text-link" onClick={() => open({ type: "gift", id: null })}>
            Log a gift
          </button>
        </section>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 text-sm font-medium text-muted">{group.label}</h2>
              <ul className="flex flex-col gap-3">
                {group.ids.map((id) => {
                  const gift = byId.get(id);
                  if (!gift) return null;
                  return (
                    <li key={gift.id}>
                      <button type="button" className="gift-row row-main press" onClick={() => open({ type: "gift", id: gift.id })}>
                        <GiftSummary
                          title={gift.title}
                          meta={`${personName(people, gift.giverId)} to ${personName(people, gift.receiverId)} · ${gift.occasion} · ${formatDate(gift.date)}`}
                          aside={formatMoney(gift.amount)}
                          direction={gift.direction}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
