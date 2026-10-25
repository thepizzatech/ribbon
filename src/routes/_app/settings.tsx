import { createFileRoute } from "@tanstack/react-router";
import { SETTINGS_TABS, SettingsPage, type SettingsTab } from "@/components/pages/settings";

function Page() {
  const { tab } = Route.useSearch();
  return <SettingsPage tab={tab ?? "general"} />;
}

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => ({
    tab: SETTINGS_TABS.some((t) => t.id === search.tab) ? (search.tab as SettingsTab) : undefined,
  }),
  component: Page,
});
