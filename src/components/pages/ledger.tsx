import { useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOverlay } from "@/components/overlay";
import { Button } from "@/components/ui";
import { STATUS_LABEL, giftStatus } from "@/lib/gifts/insights";
import { formatDate, formatMoney, personName, type Direction, type Gift } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

type SortKey = "gift" | "date" | "people" | "status" | "amount";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const STATUS_ORDER = { idea: 0, bought: 1, received: 2, given: 3, thanked: 4 } as const;

export function StatusDot({ gift }: { gift: Gift }) {
  const status = giftStatus(gift);
  return (
    <span className="status">
      <span className={`status-dot is-${status}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function LedgerPage() {
  const gifts = useLedger((state) => state.gifts);
  const people = useLedger((state) => state.people);
  const focus = useLedger((state) => state.listFocus);
  const setListFocus = useLedger((state) => state.setListFocus);
  const { open } = useOverlay();
  const search = useSearch({ from: "/_app/ledger" });
  const [direction, setDirection] = useState<Direction | "all">("all");
  const [query, setQuery] = useState(search.q ?? "");
  const [sort, setSort] = useState<Sort>({ key: "date", dir: "desc" });

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = gifts
      .filter((gift) => (direction === "all" ? true : gift.direction === direction))
      .filter((gift) => {
        if (focus === "thanks") return gift.direction === "received" && !gift.thanked;
        if (focus === "open") return gift.direction === "given" && gift.status !== "delivered";
        return true;
      })
      .filter((gift) => {
        if (!needle) return true;
        return [gift.title, gift.occasion, gift.note, personName(people, gift.giverId), personName(people, gift.receiverId)]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
    const sign = sort.dir === "asc" ? 1 : -1;
    const compare = (a: Gift, b: Gift): number => {
      switch (sort.key) {
        case "gift":
          return a.title.localeCompare(b.title);
        case "people":
          return personName(people, a.giverId).localeCompare(personName(people, b.giverId));
        case "status":
          return STATUS_ORDER[giftStatus(a)] - STATUS_ORDER[giftStatus(b)];
        case "amount":
          return (a.amount ?? -1) - (b.amount ?? -1);
        default:
          return a.date.localeCompare(b.date);
      }
    };
    return filtered.sort((a, b) => sign * compare(a, b) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  }, [direction, focus, gifts, people, query, sort]);

  const total = rows.reduce((sum, gift) => sum + (gift.amount ?? 0), 0);

  function toggle(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "date" || key === "amount" ? "desc" : "asc" },
    );
  }

  const head = (id: SortKey, label: string, className?: string) => {
    const active = sort.key === id;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th key={id} className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} scope="col">
        <button type="button" onClick={() => toggle(id)}>
          {label}
          <Icon size={13} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </th>
    );
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Ledger</h1>
          <p className="mt-1 text-sm text-muted">{gifts.length === 1 ? "1 gift" : `${gifts.length} gifts`}</p>
        </div>
        <div className="actions">
          <Button pill onClick={() => open({ type: "gift", id: null })}>
            <Plus size={15} strokeWidth={1.75} />
            Log gift
          </Button>
        </div>
      </div>

      <div className="toolbar">
        <label className="search-field">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input
            className="field"
            type="search"
            value={query}
            placeholder="Search gifts, people, occasions"
            aria-label="Search gifts"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="segment" role="group" aria-label="Direction">
          {(
            [
              ["all", "All"],
              ["received", "Received"],
              ["given", "Given"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" className={direction === value ? "is-on" : ""} onClick={() => setDirection(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chip-row" role="group" aria-label="Focus">
          {(
            [
              ["thanks", "Thank-yous owed"],
              ["open", "Still to give"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={focus === value}
              className={focus === value ? "chip is-on" : "chip"}
              onClick={() => setListFocus(focus === value ? "all" : value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <section className="card empty">
          <h2 className="card-title">No gifts match</h2>
          <p className="text-muted">Try another search, or log the gift you have in mind.</p>
          <Button onClick={() => open({ type: "gift", id: null })}>Log a gift</Button>
        </section>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="ledger-table">
              <caption className="sr-only">Gifts, sortable by column</caption>
              <thead>
                <tr>
                  {head("gift", "Gift")}
                  {head("people", "From → To")}
                  {head("date", "Date")}
                  {head("status", "Status")}
                  {head("amount", "Amount", "c-amount")}
                </tr>
              </thead>
              <tbody>
                {rows.map((gift) => (
                  <tr key={gift.id} onClick={() => open({ type: "gift", id: gift.id })}>
                    <td className="c-gift">
                      <button
                        type="button"
                        className="row-title"
                        onClick={(event) => {
                          event.stopPropagation();
                          open({ type: "gift", id: gift.id });
                        }}
                      >
                        {gift.title}
                      </button>
                      <span className="row-sub">{gift.occasion}</span>
                    </td>
                    <td className="c-people">
                      {personName(people, gift.giverId)} <ArrowRight size={12} className="arrow-gap inline" aria-label="to" />{" "}
                      {personName(people, gift.receiverId)}
                    </td>
                    <td className="c-date">{formatDate(gift.date)}</td>
                    <td className="c-status">
                      <StatusDot gift={gift} />
                    </td>
                    <td className="c-amount">{formatMoney(gift.amount) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>{rows.length === 1 ? "1 gift" : `${rows.length} gifts`}</span>
            <span className="tnum">{total > 0 ? `${formatMoney(total)} recorded` : ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
