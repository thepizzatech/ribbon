import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BookOpen, House, MessageCircle, Moon, Plus, Settings, Sun, Users } from "lucide-react";
import { Mark } from "@/components/mark";
import { OverlayProvider, useOverlay } from "@/components/overlay";
import { GiftSheet } from "@/components/gift-sheet";
import { PersonSheet } from "@/components/person-sheet";
import { SettingsSheet } from "@/components/settings-sheet";
import { useLedger } from "@/lib/gifts/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home", icon: House, exact: true },
  { to: "/ledger", label: "Ledger", icon: BookOpen, exact: false },
  { to: "/people", label: "People", icon: Users, exact: false },
  { to: "/ask", label: "Ask", icon: MessageCircle, exact: false },
] as const;

function isActive(pathname: string, to: string, exact: boolean) {
  if (exact) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function Wordmark() {
  const household = useLedger((state) => state.householdName);
  return (
    <div className="brand min-w-0">
      <span className="brand-mark">
        <Mark />
      </span>
      <span className="min-w-0">
        <span className="brand-name block truncate">Ribbon</span>
        <span className="block truncate text-sm text-muted md:hidden">{household}</span>
      </span>
    </div>
  );
}

function NavLinks({ variant }: { variant: "dock" | "side" }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const setListFocus = useLedger((state) => state.setListFocus);

  return (
    <>
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.to, item.exact);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(variant === "dock" ? "nav-link" : "side-link", active && "is-active")}
            onClick={() => {
              if (item.to === "/ledger") setListFocus("all");
            }}
          >
            <Icon size={18} strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function ThemeButton() {
  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("ribbon-theme", next);
    } catch {
      /* private mode */
    }
  }

  return (
    <button type="button" className="icon-btn press set-btn" aria-label="Toggle color theme" onClick={toggle}>
      <Moon className="theme-moon" size={18} strokeWidth={1.75} />
      <Sun className="theme-sun" size={18} strokeWidth={1.75} />
      <span className="set-label theme-dark-label">Dark</span>
      <span className="set-label theme-light-label">Light</span>
    </button>
  );
}

function Actions() {
  const { open } = useOverlay();
  return (
    <div className="flex items-center gap-1 md:flex-col md:items-stretch">
      <ThemeButton />
      <button
        type="button"
        className="icon-btn press set-btn"
        aria-label="Ledger settings"
        onClick={() => open({ type: "settings" })}
      >
        <Settings size={18} strokeWidth={1.75} />
        <span className="set-label">Settings</span>
      </button>
      <button
        type="button"
        className="icon-btn primary press log-btn"
        aria-label="Log a gift"
        onClick={() => open({ type: "gift", id: null })}
      >
        <Plus size={18} strokeWidth={1.75} />
        <span className="log-label">Log gift</span>
      </button>
    </div>
  );
}

function Frame() {
  const household = useLedger((state) => state.householdName);
  return (
    <div className="app">
      <aside className="sidebar">
        <Wordmark />
        <p className="nav-kicker">Ledger</p>
        <nav className="flex flex-col gap-1" aria-label="Primary">
          <NavLinks variant="side" />
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <p className="nav-kicker">Household</p>
          <Actions />
          <div className="side-user">
            <span className="brand-mark">
              <Mark />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{household}</span>
              <span className="block truncate text-xs text-muted">On this device</span>
            </span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <Wordmark />
          <Actions />
        </header>
        <div className="page">
          <Outlet />
        </div>
      </div>
      <nav className="dock" aria-label="Primary">
        <NavLinks variant="dock" />
      </nav>
      <GiftSheet />
      <PersonSheet />
      <SettingsSheet />
    </div>
  );
}

export function Shell() {
  return (
    <OverlayProvider>
      <Frame />
    </OverlayProvider>
  );
}
