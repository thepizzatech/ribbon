import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  CalendarDays,
  CircleHelp,
  Gift,
  House,
  Shuffle,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mark } from "@/components/mark";
import { OverlayProvider, useOverlay } from "@/components/overlay";
import { GiftSheet } from "@/components/gift-sheet";
import { PersonSheet } from "@/components/person-sheet";
import { Toaster } from "@/components/toaster";
import { api } from "@/lib/gifts/api";
import { xapi } from "@/lib/gifts/api-extra";
import { todayLocal } from "@/lib/gifts/upcoming";
import { needsYou } from "@/lib/gifts/insights";
import { useLedger } from "@/lib/gifts/store";
import { setTheme, useTheme } from "@/lib/theme";
import { useSession } from "@/lib/gifts/use-session";
import { startTour } from "@/lib/tour";
import { versionLabel } from "@/lib/version";
import { cn } from "@/lib/utils";

type NavItem = { to: "/" | "/calendar" | "/ledger" | "/people" | "/ask" | "/shared" | "/santa"; label: string; icon: LucideIcon; exact: boolean };

const NAV: readonly NavItem[] = [
  { to: "/", label: "Overview", icon: House, exact: true },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, exact: false },
  { to: "/ledger", label: "Ledger", icon: BookOpen, exact: false },
  { to: "/people", label: "People", icon: Users, exact: false },
  { to: "/ask", label: "Ask", icon: MessageCircle, exact: false },
];

/** Sidebar-only extras: reachable on a phone from the People page. */
const MORE: readonly NavItem[] = [
  { to: "/shared", label: "Shared wishlists", icon: Gift, exact: false },
  { to: "/santa", label: "Secret Santa", icon: Shuffle, exact: false },
];

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
        <span className="brand-name block truncate leading-tight">Ribbon</span>
        <span className="block truncate text-xs text-muted lg:hidden">{household}</span>
      </span>
    </div>
  );
}

/** Little dots beside Calendar: one per kind of event happening today. They fade in with the calendar's events. */
function TodayDots() {
  const today = todayLocal();
  const summary = useQuery({ queryKey: ["calendar", "summary", today], queryFn: () => xapi.calSummary(today), refetchOnWindowFocus: false, retry: false });
  const tones = summary.data?.todayTones ?? [];
  if (tones.length === 0) return null;
  return (
    <span className="nav-dots" role="img" aria-label={`${summary.data?.todayCount ?? tones.length} on today`}>
      {tones.map((tone, i) => (
        <i key={tone} className={`tone-${tone} rise`} style={{ animationDelay: `${300 + i * 120}ms` }} />
      ))}
    </span>
  );
}

function NavLinks({ variant, items }: { variant: "dock" | "side"; items: readonly NavItem[] }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const setListFocus = useLedger((state) => state.setListFocus);

  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.to, item.exact);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            data-tour={`nav-${item.label.toLowerCase()}`}
            className={cn(variant === "dock" ? "nav-link" : "side-link", active && "is-active")}
            onClick={() => {
              if (item.to === "/ledger") setListFocus("all");
            }}
          >
            <Icon size={variant === "dock" ? 20 : 18} strokeWidth={1.5} />
            {item.label}
            {item.to === "/calendar" ? <TodayDots /> : null}
          </Link>
        );
      })}
    </>
  );
}

function ThemeButton({ className }: { className?: string }) {
  const theme = useTheme();
  return (
    <button
      type="button"
      className={cn("icon-btn press", className)}
      data-tour="theme"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
    </button>
  );
}

function SideSearch() {
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    void navigate({ to: "/ledger", search: { q: value.trim() || undefined } });
    ref.current?.blur();
  }

  return (
    <form className="side-search" role="search" onSubmit={submit}>
      <Search size={16} strokeWidth={1.5} className="search-icon" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder="Search"
        aria-label="Search gifts, people, occasions"
        onChange={(event) => setValue(event.target.value)}
      />
      <span className="kbd" aria-hidden="true">
        ⌘K
      </span>
    </form>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "R") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

function Sidebar() {
  const household = useLedger((state) => state.householdName);
  const user = useQuery({ queryKey: ["session"], queryFn: api.session, refetchOnWindowFocus: false }).data?.user;
  const gifts = useLedger((state) => state.gifts);
  const people = useLedger((state) => state.people);
  const setListFocus = useLedger((state) => state.setListFocus);
  const needs = needsYou(gifts, people);
  const navigate = useNavigate();

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Wordmark />
        <ThemeButton className="is-bordered sm" />
      </div>
      <SideSearch />
      <nav className="mt-3 flex flex-col gap-1" aria-label="Primary">
        <NavLinks variant="side" items={NAV.slice(0, 3)} />
        <p className="nav-kicker">Explore</p>
        <NavLinks variant="side" items={[...NAV.slice(3), ...MORE]} />
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <button
          type="button"
          className="side-link"
          onClick={() => {
            setListFocus(needs.thanks.length > 0 ? "thanks" : "open");
            void navigate({ to: "/ledger", search: {} });
          }}
        >
          <Bell size={18} strokeWidth={1.5} />
          Notifications
          {needs.count > 0 ? (
            <span className="badge" aria-label={`${needs.count} things need you`}>
              {needs.count}
            </span>
          ) : null}
        </button>
        <Link to="/settings" search={{}} className="side-link" data-tour="nav-settings" activeProps={{ "aria-current": "page", className: "side-link is-active" }}>
          <Settings size={18} strokeWidth={1.5} />
          Settings
        </Link>
        <a
          className="side-link"
          href="https://github.com/thepizzatech/ribbon#readme"
          target="_blank"
          rel="noreferrer"
        >
          <CircleHelp size={18} strokeWidth={1.5} />
          Help
        </a>
        <div className="side-user mt-2">
          <span className="avatar" aria-hidden="true">
            {initials(user?.displayName ?? household)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user?.displayName ?? household}</span>
            <span className="block truncate text-xs text-muted">
              {user ? (user.role === "owner" ? "Owner" : "Member") : "Household"} · {household}
            </span>
          </span>
        </div>
        <p className="side-version">Ribbon {versionLabel()}</p>
      </div>
    </aside>
  );
}

function Topbar() {
  const { open } = useOverlay();
  return (
    <header className="topbar">
      <Wordmark />
      <div className="flex items-center gap-1">
        <ThemeButton />
        <Link to="/settings" search={{}} className="icon-btn press" aria-label="Settings" data-tour="nav-settings">
          <Settings size={18} strokeWidth={1.5} />
        </Link>
        <button
          type="button"
          className="btn btn-primary btn-pill press"
          aria-label="Log a gift"
          data-tour="add-gift"
          onClick={() => open({ type: "gift", id: null })}
        >
          <Plus size={16} strokeWidth={1.75} />
          Gift
        </button>
      </div>
    </header>
  );
}

/** Opens the tour once per browser tab session when the server says this login should see it. */
function useTourAutostart() {
  const session = useSession();
  const navigate = useNavigate();
  const autoShow = session.data?.tour?.autoShow === true;
  useEffect(() => {
    if (!autoShow) return;
    const timer = window.setTimeout(() => {
      if (sessionStorage.getItem("ribbon-tour-auto")) return;
      sessionStorage.setItem("ribbon-tour-auto", "1");
      void startTour({
        beforeStart: async () => {
          if (window.location.pathname !== "/") {
            await navigate({ to: "/" });
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        },
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [autoShow, navigate]);
}

function Frame() {
  useTourAutostart();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="app">
      <a href="#main" className="skip-link sr-only-focusable">
        Skip to content
      </a>
      <div className="window">
        <Sidebar />
        <div className="app-main">
          <Topbar />
          <main id="main" className="page">
            <div key={pathname} className="page-enter">
              <Outlet />
            </div>
          </main>
        </div>
        <nav className="dock" aria-label="Primary">
          <NavLinks variant="dock" items={NAV} />
        </nav>
      </div>
      <GiftSheet />
      <PersonSheet />
      <Toaster />
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
