import { createFileRoute } from "@tanstack/react-router";
import { LedgerPage } from "@/components/pages/ledger";

export const Route = createFileRoute("/_app/ledger")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.slice(0, 100) : undefined,
  }),
  component: LedgerPage,
});
