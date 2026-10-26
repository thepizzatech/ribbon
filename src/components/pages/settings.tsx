import { Link, useNavigate } from "@tanstack/react-router";
import { AccountSection } from "@/components/account";
import { InsecureNotice } from "@/components/auth";
import { AccountExtras } from "@/components/settings/account-tab";
import { CalendarsTab } from "@/components/settings/calendars";
import { DataTab } from "@/components/settings/data";
import { GeneralTab } from "@/components/settings/general";
import { HelpTab } from "@/components/settings/help";
import { SharingTab } from "@/components/settings/sharing";
import { useSession } from "@/lib/gifts/use-session";
import { cn } from "@/lib/utils";

export const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "account", label: "Account" },
  { id: "calendars", label: "Calendars" },
  { id: "data", label: "Data" },
  { id: "sharing", label: "Sharing" },
  { id: "help", label: "Help" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

export function SettingsPage({ tab }: { tab: SettingsTab }) {
  const session = useSession();
  const navigate = useNavigate();

  function onKey(event: React.KeyboardEvent, index: number) {
    const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!move) return;
    event.preventDefault();
    const next = SETTINGS_TABS[(index + move + SETTINGS_TABS.length) % SETTINGS_TABS.length]!;
    void navigate({ to: "/settings", search: { tab: next.id } });
    requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="mt-1 text-sm text-muted">The ledger is stored on your Ribbon server. Export a copy any time.</p>
        </div>
      </div>
      {session.data && !session.data.secure ? (
        <div className="mb-4" style={{ maxWidth: 760 }}>
          <InsecureNotice session={session.data} />
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((item, index) => (
          <Link
            key={item.id}
            id={`tab-${item.id}`}
            to="/settings"
            search={{ tab: item.id }}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="settings-panel"
            tabIndex={tab === item.id ? 0 : -1}
            className={cn("tab")}
            onKeyDown={(event) => onKey(event, index)}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "general" ? <GeneralTab /> : null}
        {tab === "account" ? (
          <div className="settings-grid">
            <section className="card">
              <AccountSection />
            </section>
            <AccountExtras />
          </div>
        ) : null}
        {tab === "calendars" ? <CalendarsTab /> : null}
        {tab === "data" ? <DataTab /> : null}
        {tab === "sharing" ? <SharingTab /> : null}
        {tab === "help" ? <HelpTab /> : null}
      </div>
    </div>
  );
}
