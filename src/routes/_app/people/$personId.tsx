import { createFileRoute } from "@tanstack/react-router";
import { PersonPage } from "@/components/pages/person";

export const Route = createFileRoute("/_app/people/$personId")({
  component: function PersonRoute() {
    const { personId } = Route.useParams();
    return <PersonPage personId={personId} />;
  },
});
