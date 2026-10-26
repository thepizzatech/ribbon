import { createFileRoute } from "@tanstack/react-router";
import { SETTINGS_TABS, SettingsPage, type SettingsTab } from "@/components/pages/settings";

function Page() {
  const { tab } = Route.useSearch();
  return <SettingsPage tab={tab ?? "general"} />;
}

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab; google?: "connected" | "error"; reason?: string } => ({
    tab: SETTINGS_TABS.some((t) => t.id === search.tab) ? (search.tab as SettingsTab) : undefined,
    google: search.google === "connected" || search.google === "error" ? search.google : undefined,
    reason: typeof search.reason === "string" ? search.reason.slice(0, 20) : undefined,
  }),
  component: Page,
});
