import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Copy, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, TextInput } from "@/components/ui";
import { ApiError } from "@/lib/gifts/api";
import { xapi } from "@/lib/gifts/api-extra";
import { useLedger } from "@/lib/gifts/store";
import { useSession } from "@/lib/gifts/use-session";
import { toast } from "@/lib/toast";

const msg = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback);

/** "This is me": hides surprises planned for that person from this login. One-way for yourself. */
export function MyPersonSection() {
  const session = useSession();
  const queryClient = useQueryClient();
  const people = useLedger((s) => s.people);
  const [picked, setPicked] = useState("");
  const [message, setMessage] = useState("");
  const user = session.data?.user;
  if (!user) return null;
  const mine = people.find((p) => p.id === user.personId);
  const save = useMutation({
    mutationFn: () => xapi.setMyPerson(picked),
    onSuccess: () => {
      toast("Linked. Gifts planned for you are now hidden.");
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e) => setMessage(msg(e, "Couldn’t link that.")),
  });
  return (
    <section className="card stack" aria-labelledby="me-title">
      <div>
        <h2 className="card-title" id="me-title">
          Which person are you?
        </h2>
        <p className="card-sub">Gifts and budgets planned for your person are hidden from you, so surprises stay surprises.</p>
      </div>
      {mine ? (
        <p className="text-sm">
          You are <b>{mine.name}</b>. To change this, ask another owner.
        </p>
      ) : (
        <>
          <label className="lbl">
            I am…
            <span className="select-wrap">
              <select className="field" value={picked} onChange={(e) => setPicked(e.target.value)}>
                <option value="">Choose yourself</option>
                {people.filter((p) => p.circle === "household").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <p className="text-xs text-muted">You can set this once yourself. Pick carefully.</p>
          {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
          <Button disabled={!picked || save.isPending} onClick={() => save.mutate()}>
            This is me
          </Button>
        </>
      )}
    </section>
  );
}

export function PasskeySection() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["passkeys"], queryFn: xapi.passkeys });
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && browserSupportsWebAuthn() && window.isSecureContext;

  async function register() {
    setBusy(true);
    setMessage("");
    try {
      const { options, challengeId } = await xapi.passkeyOptions();
      const response = await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      const done = await xapi.addPasskey(challengeId, response, name);
      queryClient.setQueryData(["passkeys"], done);
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      setName("");
      toast("Passkey added");
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "NotAllowedError";
      setMessage(cancelled ? "That was cancelled." : msg(error, "Couldn’t add a passkey."));
    } finally {
      setBusy(false);
    }
  }
  const remove = useMutation({
    mutationFn: (id: string) => xapi.removePasskey(id),
    onSuccess: (data) => {
      queryClient.setQueryData(["passkeys"], data);
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => setMessage(msg(e, "Couldn’t remove that.")),
  });

  return (
    <section className="card stack" aria-labelledby="pk-title">
      <div>
        <h2 className="card-title" id="pk-title">
          Passkeys
        </h2>
        <p className="card-sub">Sign in with your fingerprint, face or a security key. No password to type.</p>
      </div>
      <ul className="m-0 list-none p-0">
        {(list.data?.passkeys ?? []).map((pk) => (
          <li className="kv" key={pk.id}>
            <span className="k">
              <KeyRound size={14} strokeWidth={1.5} className="mr-1 inline" aria-hidden="true" />
              {pk.name}
              <span className="sub">
                Added {new Date(pk.createdAt).toLocaleDateString()}
                {pk.lastUsedAt ? ` · used ${new Date(pk.lastUsedAt).toLocaleDateString()}` : ""}
              </span>
            </span>
            <button type="button" className="icon-btn sm" aria-label={`Remove passkey ${pk.name}`} onClick={() => remove.mutate(pk.id)}>
              <Trash2 size={14} strokeWidth={1.5} />
            </button>
          </li>
        ))}
      </ul>
      {supported ? (
        <div className="flex gap-2">
          <TextInput value={name} maxLength={40} placeholder="Name it, like “Phone”" aria-label="Passkey name" onChange={(e) => setName(e.target.value)} />
          <Button variant="secondary" disabled={busy} onClick={() => void register()}>
            Add passkey
          </Button>
        </div>
      ) : (
        <p className="notice">
          Passkeys need a secure connection (HTTPS, or localhost) and a browser that supports them. Open Ribbon through its HTTPS address to add one.
        </p>
      )}
      {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
    </section>
  );
}

export function SsoSection() {
  const session = useSession();
  const queryClient = useQueryClient();
  const sso = session.data?.sso;
  const [message, setMessage] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("sso") === "linked") toast("Single sign-on linked");
    if (q.has("sso_error")) setMessage("Couldn’t link that single sign-on account. It may already belong to another login.");
  }, []);
  const unlink = useMutation({
    mutationFn: () => xapi.unlinkSso(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["session"] }),
    onError: (e) => setMessage(msg(e, "Couldn’t unlink.")),
  });
  if (!sso?.enabled) return null;
  return (
    <section className="card stack" aria-labelledby="sso-title">
      <div>
        <h2 className="card-title" id="sso-title">
          Single sign-on
        </h2>
        <p className="card-sub">{sso.linked ? "This login is linked to your single sign-on account." : "Link your single sign-on account to sign in with one click."}</p>
      </div>
      {sso.linked ? (
        <Button variant="secondary" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
          Unlink
        </Button>
      ) : (
        <a className="btn btn-secondary press" href="/api/auth/oidc/start?link=1">
          Link {sso.label?.replace(/^Sign in with /i, "") || "SSO"}
        </a>
      )}
      {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
    </section>
  );
}

export function CalendarSection() {
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ["calendar"], queryFn: xapi.calendar });
  const [message, setMessage] = useState("");
  const token = info.data?.token ?? null;
  const url = token ? `${window.location.origin}/api/calendar/${token}.ics` : "";
  const apply = (data: Awaited<ReturnType<typeof xapi.calendar>>) => queryClient.setQueryData(["calendar"], data);
  const make = useMutation({ mutationFn: () => xapi.newCalendarToken(), onSuccess: apply });
  const off = useMutation({ mutationFn: () => xapi.removeCalendarToken(), onSuccess: apply });
  const days = useMutation({ mutationFn: (n: number) => xapi.setRemindDays(n), onSuccess: apply, onError: (e) => setMessage(msg(e, "Couldn’t save that.")) });
  const webcal = url.replace(/^https?:/, "webcal:");

  return (
    <section className="card stack" aria-labelledby="cal-title">
      <div>
        <h2 className="card-title" id="cal-title">
          Calendar feed
        </h2>
        <p className="card-sub">
          Birthdays, anniversaries and yearly occasions in your calendar app, plus a “start shopping” reminder ahead of each one.
        </p>
      </div>
      {token ? (
        <>
          <div className="copybox">
            <input className="field" readOnly value={url} aria-label="Calendar feed address" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="secondary"
              aria-label="Copy the calendar address"
              onClick={() => void navigator.clipboard?.writeText(url).then(() => toast("Address copied"))}
            >
              <Copy size={15} strokeWidth={1.5} />
            </Button>
          </div>
          <p className="text-xs text-muted">
            Anyone with this address can read your dates, so keep it private. Add it as a subscription (“From URL”) in Google Calendar, Apple Calendar or Outlook.
          </p>
          <label className="lbl">
            Start shopping reminder
            <span className="select-wrap">
              <select className="field" value={info.data?.remindDays ?? 14} onChange={(e) => days.mutate(Number(e.target.value))}>
                <option value={0}>Off</option>
                {[7, 14, 21, 30, 45].map((n) => (
                  <option key={n} value={n}>
                    {n} days before
                  </option>
                ))}
              </select>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-secondary press" href={webcal}>
              Open in calendar app
            </a>
            <Button
              variant="secondary"
              onClick={() => {
                if (window.confirm("Make a new address? Calendars using the old one stop updating.")) make.mutate();
              }}
            >
              <RefreshCw size={14} strokeWidth={1.5} /> New address
            </Button>
            <Button variant="ghost" onClick={() => off.mutate()}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" onClick={() => make.mutate()} disabled={make.isPending}>
          Create calendar feed
        </Button>
      )}
      {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
    </section>
  );
}

