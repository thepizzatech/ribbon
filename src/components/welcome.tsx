import { useQuery } from "@tanstack/react-query";
import { LogOut, Moon, Plus, Sun, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mark } from "@/components/mark";
import { RelationshipSelect } from "@/components/relationship-select";
import { Button, Field, Switch, TextInput } from "@/components/ui";
import { ApiError, api, type WelcomeMember } from "@/lib/gifts/api";
import type { Relationship } from "@/lib/gifts/model";
import { setTheme, useTheme } from "@/lib/theme";

type Member = { key: number; name: string; relationship: Relationship; custom: string; household: boolean };

let memberKey = 0;
const blankMember = (): Member => ({ key: (memberKey += 1), name: "", relationship: "partner", custom: "", household: true });

const fromServer = (m: WelcomeMember): Member => ({
  key: (memberKey += 1),
  name: m.name,
  relationship: m.relationship as Relationship,
  custom: m.role ?? "",
  household: m.household,
});

const toServer = (members: Member[]): WelcomeMember[] =>
  members
    .filter((member) => member.name.trim())
    .map((member) => ({
      name: member.name.trim(),
      relationship: member.relationship,
      role: member.relationship === "other" ? member.custom.trim() : undefined,
      household: member.household,
    }));

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * The Welcome setup: a full-page wizard shown to the owner right after the first sign-in.
 * Every step is saved on the server, so closing the tab or signing in elsewhere picks up where it left off.
 */
export function WelcomeSetup({ username, onDone, onSignOut }: { username: string; onDone: () => Promise<void> | void; onSignOut: () => void }) {
  const state = useQuery({ queryKey: ["welcome"], queryFn: api.welcome, staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false });
  const theme = useTheme();
  const [step, setStep] = useState<1 | 2>(1);
  const [familyName, setFamilyName] = useState("");
  const [yourName, setYourName] = useState("");
  const [members, setMembers] = useState<Member[]>([blankMember()]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  const dirty = useRef(false);

  // Pick up whatever the server already has (this is how an abandoned setup resumes).
  useEffect(() => {
    if (!state.data || loaded.current) return;
    loaded.current = true;
    setFamilyName(state.data.familyName);
    setYourName(state.data.yourName);
    setStep(state.data.step === 2 ? 2 : 1);
    if (state.data.members.length > 0) setMembers(state.data.members.map(fromServer));
  }, [state.data]);

  // Save the family list shortly after it changes, so a closed tab does not lose it.
  useEffect(() => {
    if (!dirty.current || step !== 2) return;
    const timer = window.setTimeout(() => {
      void api.saveWelcome({ members: toServer(members), step: 2 }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [members, step]);

  function patchMember(key: number, patch: Partial<Member>) {
    dirty.current = true;
    setMembers((current) => current.map((member) => (member.key === key ? { ...member, ...patch } : member)));
  }

  async function toFamily(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!familyName.trim()) return setMessage("Give your family a name.");
    setBusy(true);
    try {
      await api.saveWelcome({ familyName: familyName.trim(), yourName: yourName.trim(), step: 2 });
      setStep(2);
    } catch (error) {
      setMessage(messageOf(error, "Couldn’t save that. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      await api.finishWelcome({ familyName: familyName.trim(), yourName: yourName.trim(), members: toServer(members) });
      await onDone();
    } catch (error) {
      setMessage(messageOf(error, "Couldn’t finish setup. Try again."));
      setBusy(false);
    }
  }

  async function back() {
    setMessage("");
    try {
      await api.saveWelcome({ members: toServer(members), step: 1 });
    } catch {
      /* going back never needs the save to work */
    }
    setStep(1);
  }

  const error = message ? (
    <p className="auth-error" role="alert">
      {message}
    </p>
  ) : null;

  return (
    <div className="welcome">
      <header className="welcome-bar">
        <span className="welcome-brand">
          <span className="brand-mark" aria-hidden="true">
            <Mark />
          </span>
          Ribbon
        </span>
        <div className="welcome-bar-actions">
          <span className="welcome-user">{username}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
          </button>
          <button type="button" className="btn btn-ghost btn-sm press" onClick={onSignOut}>
            <LogOut size={14} strokeWidth={1.5} /> Sign out
          </button>
        </div>
      </header>

      <main className="welcome-main">
        <div className="welcome-progress" role="img" aria-label={`Step ${step} of 2`}>
          <span className="is-on" />
          <span className={step === 2 ? "is-on" : ""} />
        </div>
        <p className="welcome-kicker">Welcome setup · Step {step} of 2</p>

        {state.isError ? (
          <section className="welcome-card">
            <p className="auth-error" role="alert">
              {messageOf(state.error, "Couldn’t load your setup.")}
            </p>
            <Button onClick={() => void state.refetch()}>Try again</Button>
          </section>
        ) : !state.data ? (
          <p className="text-sm text-muted" role="status">
            Loading…
          </p>
        ) : step === 1 ? (
          <form className="welcome-form" onSubmit={toFamily}>
            <h1 className="welcome-title">Welcome to Ribbon.</h1>
            <p className="welcome-lead">Your account is ready. Let’s set up your household: what to call it, and who’s in it. It takes about a minute, and you can change all of it later.</p>
            <section className="welcome-card">
              <Field label="Family or household name" hint="Shown at the top of your ledger, like “The Rivers”.">
                <TextInput autoFocus maxLength={80} value={familyName} onChange={(event) => setFamilyName(event.target.value)} />
              </Field>
              <Field label="Your name" hint="How you appear in the ledger. Optional.">
                <TextInput maxLength={80} autoComplete="name" value={yourName} onChange={(event) => setYourName(event.target.value)} />
              </Field>
            </section>
            {error}
            <div className="welcome-actions">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Continue"}
              </Button>
            </div>
          </form>
        ) : (
          <form className="welcome-form" onSubmit={finish}>
            <h1 className="welcome-title">Who’s in your family?</h1>
            <p className="welcome-lead">Add the people you give gifts to or get them from, with how they’re related to you: son, wife, mother, friend. You can skip this and add them later.</p>
            <ul className="welcome-members">
              {members.map((member, index) => (
                <li key={member.key} className="member-row welcome-card">
                  <TextInput
                    aria-label={`Name of person ${index + 1}`}
                    placeholder="Name"
                    maxLength={80}
                    value={member.name}
                    onChange={(event) => patchMember(member.key, { name: event.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove person ${index + 1}`}
                    onClick={() => {
                      dirty.current = true;
                      setMembers((current) => current.filter((item) => item.key !== member.key));
                    }}
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                  <div className="full">
                    <RelationshipSelect
                      label={`Relationship of person ${index + 1}`}
                      value={member.relationship}
                      onChange={(relationship) => patchMember(member.key, { relationship })}
                    />
                  </div>
                  {member.relationship === "other" ? (
                    <div className="full">
                      <TextInput
                        aria-label={`Describe person ${index + 1}`}
                        placeholder="Neighbor, coworker…"
                        maxLength={40}
                        value={member.custom}
                        onChange={(event) => patchMember(member.key, { custom: event.target.value })}
                      />
                    </div>
                  ) : null}
                  <div className="full">
                    <Switch id={`member-${member.key}`} label="Lives in your household" checked={member.household} onChange={(household) => patchMember(member.key, { household })} />
                  </div>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              onClick={() => {
                dirty.current = true;
                setMembers((current) => [...current, blankMember()]);
              }}
            >
              <Plus size={16} strokeWidth={1.5} />
              Add {members.some((m) => m.name.trim()) ? "another person" : "a person"}
            </Button>
            {error}
            <div className="welcome-actions">
              <Button variant="secondary" disabled={busy} onClick={() => void back()}>
                Back
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Finishing…" : members.some((m) => m.name.trim()) ? "Finish setup" : "Skip and finish"}
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
