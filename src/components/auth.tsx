import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { KeyRound } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Mark } from "@/components/mark";
import { Button, Field, TextInput } from "@/components/ui";
import { ApiError, api, type Session, type SetupInput } from "@/lib/gifts/api";
import { xapi } from "@/lib/gifts/api-extra";
import { versionLabel } from "@/lib/version";

export function AuthFrame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <Mark />
          </span>
          Ribbon
        </div>
        <h1 id="auth-title" className="auth-title">
          {title}
        </h1>
        {lead ? <p className="auth-lead">{lead}</p> : <div className="h-5" />}
        {children}
      </section>
      <p className="auth-foot">Ribbon {versionLabel()}</p>
    </main>
  );
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function InsecureNotice({ session }: { session: Pick<Session, "secure" | "insecureLoginBlocked" | "privateNetwork"> }) {
  if (session.secure) return null;
  return (
    <p className="auth-warn" role={session.insecureLoginBlocked ? "alert" : "note"}>
      <strong>Connection not secure.</strong>{" "}
      {session.insecureLoginBlocked ??
        (session.privateNetwork
          ? "This page is on plain HTTP. That is fine on your home network, but anyone on it could read your password. Use an HTTPS address before opening Ribbon to the internet."
          : "This page is on plain HTTP. Use an HTTPS address.")}
    </p>
  );
}

const SSO_MESSAGES: Record<string, string> = {
  denied: "Sign-in was cancelled or refused by your provider.",
  state: "That sign-in took too long or was opened twice. Try again.",
  verify: "Couldn’t verify the sign-in with your provider. Try again, or ask the person who runs Ribbon.",
  nolink: "That account isn’t linked to a Ribbon login. Ask an owner to add you, or sign in with a password and link it in Settings.",
  provider: "Your sign-in provider isn’t reachable right now.",
  session: "Couldn’t start your session. Try again.",
  taken: "That account is already linked to a different login.",
};

export function LoginForm({ session, onDone }: { session: Session; onDone: (session: Session) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") return "";
    const code = new URLSearchParams(window.location.search).get("sso_error");
    return code ? (SSO_MESSAGES[code] ?? "Single sign-on didn’t work.") : "";
  });
  const [busy, setBusy] = useState(false);
  const sso = session.sso?.enabled ? session.sso : null;
  const passwordOff = Boolean(sso?.passwordDisabled);
  const passkeys = typeof window !== "undefined" && window.isSecureContext && browserSupportsWebAuthn();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("sso_error")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function passkeyLogin() {
    setBusy(true);
    setMessage("");
    try {
      const { options, challengeId } = await xapi.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      onDone(await xapi.passkeyLogin(challengeId, response));
    } catch (error) {
      setMessage(error instanceof Error && error.name === "NotAllowedError" ? "That was cancelled." : messageOf(error, "Couldn’t sign in with a passkey."));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      onDone(await api.login(username, password));
    } catch (error) {
      setMessage(messageOf(error, "Couldn’t sign in."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Sign in" lead="Use the login you or your family set up for Ribbon.">
      <InsecureNotice session={session} />
      {sso ? (
        <a className="btn btn-primary btn-block press" href="/api/auth/oidc/start">
          {sso.label || "Sign in with single sign-on"}
        </a>
      ) : null}
      {passkeys ? (
        <Button type="button" variant="secondary" block disabled={busy} onClick={() => void passkeyLogin()}>
          <KeyRound size={16} strokeWidth={1.5} /> Sign in with a passkey
        </Button>
      ) : null}
      {passwordOff ? (
        message ? (
          <p className="auth-error" role="alert">
            {message}
          </p>
        ) : null
      ) : (
      <form className="auth-form" onSubmit={submit}>
        <Field label="Username or email">
          <TextInput
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field label="Password">
          <TextInput
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {message ? (
          <p className="auth-error" role="alert">
            {message}
          </p>
        ) : null}
        <Button type="submit" block disabled={busy || !username.trim() || !password || Boolean(session.insecureLoginBlocked)}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      )}
    </AuthFrame>
  );
}

/** First run: create the owner login. Naming the family and adding people comes next, in the Welcome setup after the first sign-in. */
export function SetupFlow({ session, onDone }: { session: Session; onDone: (session: Session) => void }) {
  // An upgrade from a version without logins already has a ledger: only the owner login is needed.
  const accountOnly = session.hasLedger;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 10) return setMessage("Use at least 10 characters for the password.");
    if (password !== again) return setMessage("The two passwords don’t match.");
    const input: SetupInput = { username, password };
    if (session.setupCodeRequired) input.setupCode = code;
    setBusy(true);
    try {
      onDone(await api.setup(input));
    } catch (error) {
      setMessage(messageOf(error, "Couldn’t create the account."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title={accountOnly ? "Create the owner login" : "Welcome to Ribbon"}
      lead={
        accountOnly
          ? `Ribbon now needs a sign-in. Your ledger${session.householdName ? ` for ${session.householdName}` : ""} is untouched. Create the owner login to open it.`
          : "Start by creating the owner account. You’ll set up your family right after you sign in."
      }
    >
      <InsecureNotice session={session} />
      <form className="auth-form" onSubmit={finish}>
        <Field label="Username or email">
          <TextInput
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <TextInput type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label="Password again">
          <TextInput type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
        </Field>
        {session.setupCodeRequired ? (
          <Field label="Setup code" hint="Set by whoever runs this server (SETUP_CODE).">
            <TextInput type="password" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
        ) : null}
        {message ? (
          <p className="auth-error" role="alert">
            {message}
          </p>
        ) : null}
        <Button type="submit" block disabled={busy || !username.trim() || !password}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
    </AuthFrame>
  );
}

/** Offered once after sign-in when an older version left a ledger in this browser. */
export function ImportPrompt({
  summary,
  replacing,
  onImport,
  onSkip,
}: {
  summary: string;
  replacing: boolean;
  onImport: () => Promise<void>;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <AuthFrame
      title="Found a ledger in this browser"
      lead={`An older version of Ribbon saved ${summary} in this browser. Move it to your server?${replacing ? " This replaces what’s on the server right now, which has no gifts yet." : ""}`}
    >
      <div className="auth-form">
        {message ? (
          <p className="auth-error" role="alert">
            {message}
          </p>
        ) : null}
        <div className="auth-actions">
          <Button variant="secondary" disabled={busy} onClick={onSkip}>
            Not now
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onImport();
              } catch (error) {
                setMessage(messageOf(error, "Couldn’t import it."));
                setBusy(false);
              }
            }}
          >
            {busy ? "Importing…" : "Import it"}
          </Button>
        </div>
        <p className="auth-foot">The copy in this browser is kept either way.</p>
      </div>
    </AuthFrame>
  );
}
