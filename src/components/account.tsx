import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { ApiError, api, type Role } from "@/lib/gifts/api";
import { useLedger } from "@/lib/gifts/store";
import { toast } from "@/lib/toast";

const msg = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (next !== again) return setMessage("The new passwords don’t match.");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setAgain("");
      toast("Password changed");
    } catch (error) {
      setMessage(msg(error, "Couldn’t change the password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <Field label="Current password">
        <TextInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password" hint="At least 10 characters. Other devices are signed out.">
        <TextInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="New password again">
        <TextInput type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      {message ? (
        <p className="text-sm text-primary" role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" block disabled={busy || !current || !next}>
        Change password
      </Button>
    </form>
  );
}

function Logins({ selfId }: { selfId: string }) {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [message, setMessage] = useState("");
  const people = useLedger((state) => state.people);
  const sso = useQuery({ queryKey: ["session"], queryFn: api.session, refetchOnWindowFocus: false }).data?.sso?.enabled ?? false;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });
  const add = useMutation({
    mutationFn: () => api.addUser({ username, password: password || undefined, displayName: displayName || undefined, role, email: email.trim() || undefined }),
    onSuccess: () => {
      setUsername("");
      setDisplayName("");
      setPassword("");
      setEmail("");
      setMessage("");
      toast("Login added");
      void refresh();
    },
    onError: (error) => setMessage(msg(error, "Couldn’t add that login.")),
  });
  const link = useMutation({
    mutationFn: ({ id, personId }: { id: string; personId: string | null }) => api.updateUser(id, { personId }),
    onSuccess: () => void refresh(),
    onError: (error) => setMessage(msg(error, "Couldn’t link that login.")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeUser(id),
    onSuccess: () => {
      toast("Login removed");
      void refresh();
    },
    onError: (error) => setMessage(msg(error, "Couldn’t remove that login.")),
  });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="logins-title">
      <div>
        <p className="lbl" id="logins-title">
          Family logins
        </p>
        <p className="mt-1 text-sm font-normal text-muted">
          Owners can manage logins. Link each login to the person it belongs to: gifts planned for that person are hidden from that login, so surprises stay surprises.
        </p>
      </div>
      <ul className="row-list">
        {(users.data?.users ?? []).map((user) => (
          <li key={user.id} className="user-row">
            <span className="meta">
              <span className="block truncate font-medium">{user.displayName}</span>
              <span className="block truncate text-xs text-muted">{user.username}</span>
            </span>
            <label className="sr-only" htmlFor={`link-${user.id}`}>
              Which person is {user.displayName}
            </label>
            <select
              id={`link-${user.id}`}
              className="field person-link"
              value={user.personId ?? ""}
              disabled={user.id === selfId && Boolean(user.personId)}
              onChange={(event) => link.mutate({ id: user.id, personId: event.target.value || null })}
            >
              <option value="">Not linked</option>
              {people
                .filter((p) => p.circle === "household" || p.id === user.personId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <span className="role-chip">{user.role === "owner" ? "Owner" : "Member"}</span>
            {user.id !== selfId ? (
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove login for ${user.displayName}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Remove the login for ${user.displayName}? They’ll be signed out.`)) remove.mutate(user.id);
                }}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          add.mutate();
        }}
      >
        <Field label="Name">
          <TextInput value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Username or email">
          <TextInput
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Email" hint={sso ? "Optional. Used to match their single sign-on account." : "Optional."}>
          <TextInput type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint={sso ? "Leave empty for a single sign-on-only login." : "At least 10 characters. Share it with them privately."}>
          <TextInput type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="segment" role="group" aria-label="Role">
          <button type="button" className={role === "member" ? "is-on" : ""} onClick={() => setRole("member")}>
            Member
          </button>
          <button type="button" className={role === "owner" ? "is-on" : ""} onClick={() => setRole("owner")}>
            Owner
          </button>
        </div>
        {message ? (
          <p className="text-sm text-primary" role="alert">
            {message}
          </p>
        ) : null}
        <Button type="submit" variant="secondary" block disabled={add.isPending || !username.trim() || (!password && !sso)}>
          Add login
        </Button>
      </form>
    </section>
  );
}

export function AccountSection() {
  const session = useQuery({ queryKey: ["session"], queryFn: api.session, refetchOnWindowFocus: false });
  const user = session.data?.user;
  if (!user) return null;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3" aria-labelledby="account-title">
        <div>
          <p className="lbl" id="account-title">
            Account
          </p>
          <p className="mt-1 text-sm font-normal text-muted">
            Signed in as {user.displayName} ({user.username}) · {user.role === "owner" ? "Owner" : "Member"}
          </p>
        </div>
        <ChangePassword />
        <Button
          type="button"
          variant="secondary"
          block
          onClick={() => {
            void api.logout().finally(() => window.location.reload());
          }}
        >
          Sign out
        </Button>
      </section>
      {user.role === "owner" ? <Logins selfId={user.id} /> : null}
    </div>
  );
}
