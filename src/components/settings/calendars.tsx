import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { CalendarDays, Check, FileUp, FlaskConical, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Field, Switch, TextInput } from "@/components/ui";
import { ApiError } from "@/lib/gifts/api";
import { xapi } from "@/lib/gifts/api-extra";
import type { Connection, DavCalendar, ReviewItem, Tone } from "@/lib/calendar/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const msg = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback);
const COLORS: Tone[] = ["purple", "pink", "red", "blue", "green", "amber"];
const KIND = { ics_url: "Calendar link", ics_file: "File", google: "Google Calendar", caldav: "CalDAV" } as const;
const GOOGLE_PROBLEM: Record<string, string> = {
  config: "Google sign-in isn’t set up on this server.",
  busy: "Too many attempts. Wait a few minutes and try again.",
  state: "That sign-in expired or came from another browser. Start again.",
  denied: "You chose not to share your calendar, so nothing was connected.",
  token: "Google didn’t accept the sign-in. Try again.",
  norefresh: "Google didn’t give Ribbon lasting access. Remove Ribbon in your Google account’s third-party access and try again.",
  scope: "Ribbon needs permission to read your calendar. Tick the calendar box on Google’s screen.",
  sync: "Connected, but the first read of your calendar failed. Try again in a minute.",
};

function ago(iso: string | null): string {
  if (!iso) return "Not synced yet";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "Synced just now";
  if (s < 3600) return `Synced ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `Synced ${Math.round(s / 3600)} h ago`;
  return `Synced ${Math.round(s / 86400)} days ago`;
}

function ColorPicker({ value, onChange, label }: { value: Tone; onChange: (c: Tone) => void; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} className={cn("swatch", `tone-${c}`, value === c && "is-on")} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

function ConnectionRow({ c }: { c: Connection }) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["calendars"] });
    void client.invalidateQueries({ queryKey: ["calendar"] });
  };
  const patch = useMutation({ mutationFn: (p: Parameters<typeof xapi.updateCalendar>[1]) => xapi.updateCalendar(c.id, p), onSuccess: refresh, onError: (e) => toast(msg(e, "Couldn’t save that.")) });
  const sync = useMutation({
    mutationFn: () => xapi.syncCalendar(c.id),
    onSuccess: (d) => {
      refresh();
      toast(d.ok ? "Calendar refreshed" : (d.error ?? "Couldn’t refresh"));
    },
    onError: (e) => {
      refresh();
      toast(msg(e, "Couldn’t refresh."));
    },
  });
  const remove = useMutation({
    mutationFn: () => xapi.removeCalendar(c.id),
    onSuccess: () => {
      refresh();
      toast("Calendar removed, with its events");
    },
    onError: (e) => toast(msg(e, "Couldn’t remove that.")),
  });
  const problem = c.lastStatus === "error" || c.lastStatus === "reauth";
  return (
    <li className="conn" data-testid="connection">
      <div className="conn-main">
        <span className={cn("conn-dot", `tone-${c.color}`)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="conn-name">
            {c.name}
            {c.experimental ? (
              <span className="chip-soft ml-2 inline-flex items-center gap-1">
                <FlaskConical size={11} aria-hidden="true" /> Experimental
              </span>
            ) : null}
            {!c.enabled ? <span className="chip-soft ml-2">Hidden</span> : null}
          </p>
          <p className="conn-sub">
            {KIND[c.kind]}
            {c.host ? ` · ${c.host}` : ""}
            {c.account ? ` · ${c.account}` : ""}
            {c.calendars.length > 0 ? ` · ${c.calendars.join(", ")}` : ""}
          </p>
          <p className={cn("conn-sub", problem && "conn-bad")} role={problem ? "alert" : undefined}>
            {problem ? (c.lastError ?? "This calendar couldn’t be refreshed.") : `${c.syncs ? ago(c.lastSyncedAt) : "Imported from a file"} · ${c.eventCount} ${c.eventCount === 1 ? "event" : "events"}`}
            {!problem && c.lastError ? ` · ${c.lastError}` : ""}
          </p>
        </div>
        <div className="conn-actions">
          {c.syncs ? (
            <Button variant="secondary" small onClick={() => sync.mutate()} disabled={sync.isPending} aria-label={`Sync ${c.name} now`}>
              <RefreshCw size={14} strokeWidth={1.5} className={sync.isPending ? "spin" : ""} />
              Sync now
            </Button>
          ) : null}
          <Button variant="ghost" small onClick={() => setOpen(!open)} aria-expanded={open}>
            Options
          </Button>
        </div>
      </div>
      {open ? (
        <div className="conn-opts">
          <Switch id={`en-${c.id}`} label="Show on my calendar" checked={c.enabled} onChange={(v) => patch.mutate({ enabled: v })} />
          <Switch id={`sh-${c.id}`} label="Share with the household" checked={c.shared} onChange={(v) => patch.mutate({ shared: v })} />
          <p className="text-xs text-muted">
            {c.shared ? "Everyone in the household sees these events on their calendar." : "Only you can see these events."}
          </p>
          <ColorPicker label={`Colour for ${c.name}`} value={c.color} onChange={(color) => patch.mutate({ color })} />
          <div className="flex flex-wrap items-center gap-2">
            {confirm ? (
              <>
                <Button variant="danger" small onClick={() => remove.mutate()} disabled={remove.isPending}>
                  Remove and delete its events
                </Button>
                <Button variant="ghost" small onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" small onClick={() => setConfirm(true)}>
                <Trash2 size={14} strokeWidth={1.5} />
                {c.kind === "google" ? "Disconnect" : "Remove"}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Reviews() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["calendars", "review"], queryFn: xapi.reviews });
  const [clash, setClash] = useState<{ key: string; text: string; personId: string } | null>(null);
  const done = () => {
    void client.invalidateQueries({ queryKey: ["calendars"] });
    void client.invalidateQueries({ queryKey: ["calendar"] });
    void client.invalidateQueries({ queryKey: ["ledger"] });
  };
  const decide = useMutation({
    mutationFn: (v: Parameters<typeof xapi.decideReview>[0]) => xapi.decideReview(v),
    onSuccess: () => {
      setClash(null);
      done();
      toast("Saved");
    },
    onError: (e, v) => {
      if (e instanceof ApiError && e.status === 409 && v.personId) setClash({ key: `${v.connectionId}:${v.uid}`, text: e.message, personId: v.personId });
      else toast(msg(e, "Couldn’t save that."));
    },
  });
  const items = list.data?.items ?? [];
  if (items.length === 0) return null;
  const label = (i: ReviewItem) => `${i.name}’s ${i.kind === "birthday" ? "birthday" : "anniversary"}`;
  const pretty = (d: string) => {
    const m = /^(?:(\d{4})-|--)(\d{2})-(\d{2})$/.exec(d);
    return m ? new Date(2000, Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + (m[1] ? `, ${m[1]}` : "") : d;
  };
  return (
    <section className="card stack" aria-labelledby="rev-title">
      <div>
        <h2 className="card-title" id="rev-title">
          Birthdays found in your calendars
        </h2>
        <p className="card-sub">Ribbon spotted these. Add them to a person so gift reminders work, or ignore them. They stay on your calendar either way.</p>
      </div>
      <ul className="m-0 list-none p-0">
        {items.map((i) => {
          const key = `${i.connectionId}:${i.uid}`;
          return (
            <li key={key} className="rev">
              <p className="font-medium">{label(i)}</p>
              <p className="text-xs text-muted">
                “{i.title}” in {i.connectionName} · {pretty(i.date)}
              </p>
              {clash?.key === key ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm">{clash.text}</span>
                  <Button small onClick={() => decide.mutate({ connectionId: i.connectionId, uid: i.uid, action: "match", personId: clash.personId, overwrite: true })}>
                    Replace
                  </Button>
                  <Button small variant="ghost" onClick={() => setClash(null)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {i.matches.map((m) => (
                    <Button key={m.id} small variant="secondary" onClick={() => decide.mutate({ connectionId: i.connectionId, uid: i.uid, action: "match", personId: m.id })}>
                      <Check size={13} strokeWidth={2} />
                      It’s {m.name}
                    </Button>
                  ))}
                  <Button small variant={i.matches.length ? "ghost" : "secondary"} onClick={() => decide.mutate({ connectionId: i.connectionId, uid: i.uid, action: "create", name: i.name })}>
                    Add {i.name} as a new person
                  </Button>
                  <Button small variant="ghost" onClick={() => decide.mutate({ connectionId: i.connectionId, uid: i.uid, action: "ignore" })}>
                    Ignore
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Mode = "link" | "file" | "google" | "caldav";

function Connect({ providers }: { providers: { google: boolean } }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>("link");
  const [name, setName] = useState("");
  const [color, setColor] = useState<Tone>("purple");
  const [shared, setShared] = useState(false);
  const [url, setUrl] = useState("");
  const [contacts, setContacts] = useState(false);
  const [dav, setDav] = useState({ url: "", username: "", password: "" });
  const [found, setFound] = useState<DavCalendar[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const after = (label: string) => {
    void client.invalidateQueries({ queryKey: ["calendars"] });
    void client.invalidateQueries({ queryKey: ["calendar"] });
    setUrl("");
    setName("");
    setError("");
    setFound(null);
    setDav({ url: "", username: "", password: "" });
    toast(label);
  };
  const base = { name: name.trim() || undefined, color, shared };
  const addUrl = useMutation({ mutationFn: () => xapi.addCalendarUrl({ url: url.trim(), ...base }), onSuccess: (d) => after(`${d.connection.name} connected · ${d.connection.eventCount} events`), onError: (e) => setError(msg(e, "Couldn’t add that calendar.")) });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      if (f.size > 5 * 1024 * 1024) throw new Error("That file is bigger than 5 MB.");
      return xapi.uploadCalendar({ text: await f.text(), ...base, name: base.name ?? f.name.replace(/\.ics$/i, "") });
    },
    onSuccess: (d) => after(`${d.connection.name} imported · ${d.connection.eventCount} events`),
    onError: (e) => setError(msg(e, "Couldn’t read that file.")),
  });
  const discover = useMutation({
    mutationFn: () => xapi.discoverCaldav(dav),
    onSuccess: (d) => {
      setFound(d.calendars);
      setChosen(new Set(d.calendars.map((c) => c.href)));
      setError("");
    },
    onError: (e) => setError(msg(e, "Couldn’t reach that server.")),
  });
  const addDav = useMutation({
    mutationFn: () => xapi.addCaldav({ ...dav, calendars: [...chosen], ...base }),
    onSuccess: (d) => after(`${d.connection.name} connected · ${d.connection.eventCount} events`),
    onError: (e) => setError(msg(e, "Couldn’t connect.")),
  });
  const google = useMutation({
    mutationFn: () => xapi.googleStart({ ...base, contacts }),
    onSuccess: (d) => window.location.assign(d.url),
    onError: (e) => setError(msg(e, "Couldn’t start Google sign-in.")),
  });
  const MODES: { id: Mode; label: string }[] = [
    { id: "link", label: "Link" },
    { id: "file", label: "File" },
    ...(providers.google ? [{ id: "google" as const, label: "Google" }] : []),
    { id: "caldav", label: "Apple / CalDAV" },
  ];
  return (
    <section className="card stack" aria-labelledby="conn-title">
      <div>
        <h2 className="card-title" id="conn-title">
          Connect a calendar
        </h2>
        <p className="card-sub">Ribbon only reads your calendar. It never changes it, and your events are private to you unless you share them.</p>
      </div>
      <div className="segment is-small" role="tablist" aria-label="How to connect">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={mode === m.id ? "is-on" : ""} onClick={() => { setMode(m.id); setError(""); }}>
            {m.label}
          </button>
        ))}
      </div>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          if (mode === "link") addUrl.mutate();
          else if (mode === "google") google.mutate();
          else if (mode === "caldav") (found ? addDav : discover).mutate();
        }}
      >
        {mode === "link" ? (
          <>
            <Field label="Calendar link (iCal / .ics address)" hint="Google: Settings → your calendar → Secret address in iCal format. iCloud and Outlook: publish the calendar and copy its link. webcal:// links work.">
              <TextInput type="url" inputMode="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} required autoComplete="off" />
            </Field>
            <p className="text-xs text-muted">Treat the link like a password: anyone who has it can read the calendar. Ribbon stores it encrypted.</p>
          </>
        ) : null}
        {mode === "file" ? (
          <div className="stack">
            <p className="text-sm text-muted">Export an .ics file from your calendar app and choose it here. A file is a one-time import: it doesn’t update itself.</p>
            <input ref={file} type="file" accept=".ics,text/calendar" className="sr-only" aria-label="Choose an .ics file" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setError(""); upload.mutate(f); } e.target.value = ""; }} />
            <div>
              <Button type="button" variant="secondary" pill onClick={() => file.current?.click()} disabled={upload.isPending}>
                <FileUp size={15} strokeWidth={1.5} />
                {upload.isPending ? "Reading…" : "Choose .ics file"}
              </Button>
            </div>
          </div>
        ) : null}
        {mode === "google" ? (
          <>
            <p className="text-sm text-muted">You’ll sign in at Google and allow read-only access. Ribbon keeps a refresh token, encrypted, and can drop it any time from here.</p>
            <Switch id="contacts" label="Also read birthdays from Google Contacts" checked={contacts} onChange={setContacts} />
          </>
        ) : null}
        {mode === "caldav" ? (
          <>
            <p className="text-sm text-muted">
              <FlaskConical size={13} className="mr-1 inline" aria-hidden="true" />
              Experimental. For iCloud use <b>https://caldav.icloud.com</b>, your Apple ID, and an <b>app-specific password</b> from appleid.apple.com (Sign-In and Security). Never your normal password.
            </p>
            <Field label="Server address">
              <TextInput type="url" inputMode="url" placeholder="https://caldav.icloud.com" value={dav.url} onChange={(e) => { setDav({ ...dav, url: e.target.value }); setFound(null); }} required autoComplete="off" />
            </Field>
            <div className="wish-form-row">
              <Field label="User name">
                <TextInput value={dav.username} onChange={(e) => { setDav({ ...dav, username: e.target.value }); setFound(null); }} required autoComplete="off" />
              </Field>
              <Field label="App-specific password">
                <TextInput type="password" value={dav.password} onChange={(e) => { setDav({ ...dav, password: e.target.value }); setFound(null); }} required autoComplete="new-password" />
              </Field>
            </div>
            {found ? (
              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="lbl">Calendars to show</legend>
                {found.map((c) => (
                  <label key={c.href} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={chosen.has(c.href)} onChange={() => setChosen((cur) => { const n = new Set(cur); if (n.has(c.href)) n.delete(c.href); else n.add(c.href); return n; })} />
                    {c.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </>
        ) : null}

        {mode !== "file" ? (
          <div className="stack">
            <div className="wish-form-row">
              <Field label="Name (optional)">
                <TextInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={mode === "caldav" ? "iCloud" : mode === "google" ? "Google" : "Family"} />
              </Field>
              <div>
                <span className="lbl">Colour</span>
                <ColorPicker label="Colour" value={color} onChange={setColor} />
              </div>
            </div>
            <Switch id="share-new" label="Share with the household" checked={shared} onChange={setShared} />
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-primary" role="alert">
            {error}
          </p>
        ) : null}
        {mode !== "file" ? (
          <div>
            <Button type="submit" pill disabled={addUrl.isPending || google.isPending || discover.isPending || addDav.isPending || (mode === "caldav" && found !== null && chosen.size === 0)}>
              {mode === "link" ? <Link2 size={15} strokeWidth={1.5} /> : <CalendarDays size={15} strokeWidth={1.5} />}
              {mode === "link" ? (addUrl.isPending ? "Checking the link…" : "Add calendar") : mode === "google" ? "Continue to Google" : found ? (addDav.isPending ? "Connecting…" : "Connect selected") : discover.isPending ? "Looking…" : "Find my calendars"}
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

export function CalendarsTab() {
  const list = useQuery({ queryKey: ["calendars"], queryFn: xapi.calendars });
  const search = useSearch({ from: "/_app/settings" });
  const data = list.data;
  const outcome = search.google === "connected" ? "Google Calendar connected." : search.google === "error" ? (GOOGLE_PROBLEM[search.reason ?? ""] ?? "Google sign-in didn’t finish.") : null;
  return (
    <div className="settings-grid">
      {outcome ? (
        <p className={cn("card text-sm", search.google === "error" && "conn-bad")} role="status">
          {outcome}
        </p>
      ) : null}
      <section className="card stack" aria-labelledby="cals-title">
        <div>
          <h2 className="card-title" id="cals-title">
            Your calendars
          </h2>
          <p className="card-sub">
            Pull birthdays and events in from the calendars you already use. They appear on the Calendar page, private to you unless you share them. Refreshed about every {data?.limits.defaultSyncHours ?? 6} hours.
          </p>
        </div>
        {list.isError ? <p className="text-sm text-muted">Couldn’t load your calendars.</p> : null}
        {data && data.connections.length === 0 ? <p className="text-sm text-muted">Nothing connected yet. Add one below.</p> : null}
        <ul className="conn-list">{(data?.connections ?? []).map((c) => <ConnectionRow key={c.id} c={c} />)}</ul>
        {data && data.sharedWithMe.length > 0 ? (
          <div>
            <p className="lbl">Shared with you</p>
            <ul className="m-0 list-none p-0 text-sm text-muted">
              {data.sharedWithMe.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-1">
                  <span className={cn("conn-dot", `tone-${s.color}`)} aria-hidden="true" />
                  {s.name} · from {s.owner}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <Reviews />
      <Connect providers={{ google: data?.providers.google === true }} />
    </div>
  );
}
