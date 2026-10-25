import { createFileRoute } from "@tanstack/react-router";
import { PeoplePage } from "@/components/pages/people";

export const Route = createFileRoute("/_app/people")({
  component: PeoplePage,
});
