import { createFileRoute } from "@tanstack/react-router";
import { SharedPage } from "@/components/pages/shared";

export const Route = createFileRoute("/_app/shared")({ component: SharedPage });
