import { createFileRoute } from "@tanstack/react-router";
import { LedgerPage } from "@/components/pages/ledger";

export const Route = createFileRoute("/_app/ledger")({
  component: LedgerPage,
});
