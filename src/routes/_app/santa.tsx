import { createFileRoute } from "@tanstack/react-router";
import { SantaPage } from "@/components/pages/santa";

export const Route = createFileRoute("/_app/santa")({ component: SantaPage });
