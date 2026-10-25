import { createFileRoute } from "@tanstack/react-router";
import { LedgerGate } from "@/components/ledger-gate";
import { Shell } from "@/components/shell";

function AppRoute() {
  return (
    <LedgerGate>
      <Shell />
    </LedgerGate>
  );
}

export const Route = createFileRoute("/_app")({
  component: AppRoute,
});
