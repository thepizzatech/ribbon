import { createFileRoute } from "@tanstack/react-router";
import { AskPage } from "@/components/pages/ask";

export const Route = createFileRoute("/_app/ask")({
  component: AskPage,
});
