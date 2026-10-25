import { createFileRoute } from "@tanstack/react-router";
import { AskPage } from "@/components/pages/ask";

export const Route = createFileRoute("/_app/ask")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q.slice(0, 500) : undefined,
  }),
  component: AskPage,
});
