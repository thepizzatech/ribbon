import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { ApiError } from "@/lib/gifts/api";
import { xapi } from "@/lib/gifts/api-extra";
import { useLedger } from "@/lib/gifts/store";
import { useSession } from "@/lib/gifts/use-session";
import { toast } from "@/lib/toast";

const msg = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback);

function HouseholdsAdmin() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["households"], queryFn: xapi.households });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ familyName: "", yourName: "", username: "", password: "" });
  const [message, setMessage] = useState("");
  const add = useMutation({
    mutationFn: () => xapi.addHousehold(form),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ["households"] });
      setForm({ familyName: "", yourName: "", username: "", password: "" });
      setOpen(false);
      setMessage("");
      toast(`${d.household.name} added`);
    },
    onError: (e) => setMessage(msg(e, "Couldn’t add that household.")),
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <section className="card stack" aria-labelledby="hh-admin-title">
      <div>
        <h2 className="card-title" id="hh-admin-title">
          Households on this server
        </h2>
        <p className="card-sub">
          Each household has its own ledger and logins. Add another family here, give them their login, then link the two with an invite code.
        </p>
      </div>
      <ul className="m-0 list-none p-0">
        {(list.data?.households ?? []).map((h) => (
          <li className="kv" key={h.id}>
            <span className="k">
              {h.name}
              <span className="sub">
                {h.mine ? "Yours · " : ""}
                {h.logins} {h.logins === 1 ? "login" : "logins"}
                {h.owner ? ` · owner ${h.owner}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {open ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Household name">
            <TextInput value={form.familyName} maxLength={80} placeholder="The Okafors" onChange={set("familyName")} />
          </Field>
          <Field label="Their owner’s name">
            <TextInput value={form.yourName} maxLength={80} onChange={set("yourName")} />
          </Field>
          <Field label="Username or email">
            <TextInput value={form.username} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={set("username")} />
          </Field>
          <Field label="Password" hint="At least 10 characters. They can change it after signing in.">
            <TextInput type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
          </Field>
          {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={add.isPending || !form.familyName.trim() || !form.username.trim() || !form.password}>
              Add household
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add a household
        </Button>
      )}
    </section>
  );
}

export function SharingTab() {
  const queryClient = useQueryClient();
  const session = useSession();
  const isOwner = session.data?.user?.role === "owner";
  const summary = useQuery({ queryKey: ["sharing"], queryFn: xapi.sharing });
  const people = useLedger((s) => s.people);
  const updatePerson = useLedger((s) => s.updatePerson);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");

  const makeInvite = useMutation({ mutationFn: () => xapi.invite(), onSuccess: setInvite, onError: (e) => setMessage(msg(e, "Couldn’t make a code.")) });
  const join = useMutation({
    mutationFn: () => xapi.join(joinCode.trim()),
    onSuccess: (data) => {
      queryClient.setQueryData(["sharing"], data);
      void queryClient.invalidateQueries({ queryKey: ["shared"] });
      setJoinCode("");
      setMessage("");
      toast("Households linked");
    },
    onError: (e) => setMessage(msg(e, "That code didn’t work.")),
  });
  const unlink = useMutation({
    mutationFn: (id: string) => xapi.unlink(id),
    onSuccess: (data) => {
      queryClient.setQueryData(["sharing"], data);
      void queryClient.invalidateQueries({ queryKey: ["shared"] });
      void queryClient.invalidateQueries({ queryKey: ["exchanges"] });
    },
    onError: (e) => setMessage(msg(e, "Couldn’t unlink.")),
  });

  return (
    <div className="settings-grid">
      {session.data?.isAdmin ? <HouseholdsAdmin /> : null}
      <section className="card stack" aria-labelledby="share-title">
        <div>
          <h2 className="card-title" id="share-title">
            Share with another household
          </h2>
          <p className="card-sub">
            Link up with a family on the same Ribbon server (grandparents, a sibling’s house). Only the people you choose are visible, and only their names and
            wishlists. Your gifts, budgets and notes stay private. Surprises are kept: the person a wishlist belongs to never sees who reserved what.
          </p>
        </div>
        {isOwner ? (
          <>
            <Button variant="secondary" onClick={() => makeInvite.mutate()} disabled={makeInvite.isPending}>
              Make an invite code
            </Button>
            {invite ? (
              <div className="copybox" role="status">
                <input className="field" readOnly value={invite.code} aria-label="Invite code" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="secondary" aria-label="Copy the invite code" onClick={() => void navigator.clipboard?.writeText(invite.code).then(() => toast("Code copied"))}>
                  <Copy size={15} strokeWidth={1.5} />
                </Button>
              </div>
            ) : null}
            {invite ? <p className="text-xs text-muted">Works once, expires {new Date(invite.expiresAt).toLocaleString()}. Give it to the other household’s owner.</p> : null}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                join.mutate();
              }}
            >
              <TextInput value={joinCode} placeholder="Have a code? Paste it" aria-label="Invite code from another household" autoComplete="off" onChange={(e) => setJoinCode(e.target.value)} />
              <Button type="submit" disabled={!joinCode.trim() || join.isPending}>
                Link
              </Button>
            </form>
          </>
        ) : (
          <p className="notice">Only owners can link households.</p>
        )}
        {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
      </section>

      <section className="card stack" aria-labelledby="linked-title">
        <h2 className="card-title" id="linked-title">
          Linked households
        </h2>
        {summary.data?.links.length ? (
          <ul className="m-0 list-none p-0">
            {summary.data.links.map((link) => (
              <li className="kv" key={link.id}>
                <span className="k">{link.name}</span>
                {isOwner ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Unlink ${link.name}? They’ll stop seeing your shared people, and any shared Secret Santa spots are removed.`)) unlink.mutate(link.id);
                    }}
                  >
                    Unlink
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Not linked with anyone yet.</p>
        )}
      </section>

      <section className="card stack" aria-labelledby="who-title">
        <div>
          <h2 className="card-title" id="who-title">
            Who linked households can see
          </h2>
          <p className="card-sub">Only the people switched on here. Their name and wishlist, nothing else.</p>
        </div>
        <ul className="m-0 list-none p-0">
          {people.map((p) => (
            <li className="kv" key={p.id}>
              <label className="check k" style={{ flex: 1 }}>
                <input type="checkbox" checked={Boolean(p.shared)} disabled={!isOwner} onChange={(e) => updatePerson(p.id, { shared: e.target.checked })} />
                <span>
                  {p.name}
                  <span className="sub">{p.role || (p.circle === "household" ? "Household" : "Outside the household")}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {!isOwner ? <p className="text-xs text-muted">Owners choose who is shared.</p> : null}
      </section>
    </div>
  );
}
