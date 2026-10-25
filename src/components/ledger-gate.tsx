import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Mark } from "@/components/mark";
import { Button, Field, TextInput } from "@/components/ui";
import { ApiError, api, onUnauthorized } from "@/lib/gifts/api";
import { alreadyHandled, markHandled, readLocalLedger } from "@/lib/gifts/local-import";
import { useLedger } from "@/lib/gifts/store";
import { onSettled, pendingChanges } from "@/lib/gifts/sync";

const SESSION_KEY = ["session"] as const;
const LEDGER_KEY = ["ledger"] as const;

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">{children}</main>
  );
}

function Loading({ label = "Opening your ledger…" }: { label?: string }) {
  return (
    <Centered>
      <span className="brand-mark">
        <Mark />
      </span>
      <p className="text-sm text-muted" role="status">
        {label}
      </p>
    </Centered>
  );
}

function PasscodeForm({ onDone }: { onDone: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api.login(passcode);
      onDone();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <span className="brand-mark">
        <Mark />
      </span>
      <h1 className="display text-3xl text-foreground">Ribbon</h1>
      <form className="flex w-full max-w-xs flex-col gap-4 text-left" onSubmit={submit}>
        <Field label="Household passcode">
          <TextInput
            type="password"
            autoFocus
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
          />
        </Field>
        {message ? (
          <p className="text-sm text-muted" role="alert">
            {message}
          </p>
        ) : null}
        <Button type="submit" block disabled={busy || passcode.length === 0}>
          Open ledger
        </Button>
      </form>
    </Centered>
  );
}

/** Loads the ledger from the server (after the passcode, if one is set) and keeps the store in step with it. */
export function LedgerGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const ready = useLedger((state) => state.ready);
  const syncError = useLedger((state) => state.syncError);
  const [migrated, setMigrated] = useState(false);

  const session = useQuery({ queryKey: SESSION_KEY, queryFn: api.session, refetchOnWindowFocus: false });
  const unlocked = session.data ? !session.data.required || session.data.authed : false;

  const ledger = useQuery({
    queryKey: LEDGER_KEY,
    queryFn: api.ledger,
    enabled: unlocked,
  });

  // Any 401 means the passcode session ended: ask again.
  useEffect(() => {
    onUnauthorized(() => {
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    });
    return () => onUnauthorized(null);
  }, [queryClient]);

  // After queued changes finish, re-read the server's copy (also rolls back anything it refused).
  useEffect(() => {
    onSettled((failure) => {
      if (failure) useLedger.setState({ syncError: failure });
      void queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
    });
    return () => onSettled(null);
  }, [queryClient]);

  // One-time: move a ledger that older versions kept in this browser up to the server.
  const firstLoad = ledger.isSuccess;
  const serverIsFresh = ledger.data ? ledger.data.demo || ledger.data.people.length === 0 : false;
  useEffect(() => {
    if (!firstLoad || migrated) return;
    let cancelled = false;
    void (async () => {
      if (!alreadyHandled()) {
        const local = readLocalLedger();
        if (!local) {
          markHandled("none");
        } else if (serverIsFresh) {
          try {
            const result = await api.importLedger(local);
            queryClient.setQueryData(LEDGER_KEY, result);
            markHandled("imported");
          } catch {
            // Leave the flag unset so the next visit tries again; the local copy is untouched.
          }
        } else {
          markHandled("skipped"); // the server already holds real data; never overwrite it
        }
      }
      if (!cancelled) setMigrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [firstLoad, migrated, serverIsFresh, queryClient]);

  // Mirror the server's copy into the store, unless local changes are still on their way up.
  useEffect(() => {
    if (!ledger.data || !migrated || pendingChanges() > 0) return;
    useLedger.getState().applyServer(ledger.data);
  }, [ledger.data, migrated]);

  if (session.isError) {
    return (
      <Centered>
        <p className="text-sm text-muted" role="alert">
          Can’t reach the Ribbon server.
        </p>
        <Button onClick={() => void session.refetch()}>Try again</Button>
      </Centered>
    );
  }
  if (!session.data) return <Loading />;
  if (!unlocked) {
    return (
      <PasscodeForm
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
        }}
      />
    );
  }
  if (ledger.isError && !ready) {
    return (
      <Centered>
        <p className="text-sm text-muted" role="alert">
          Couldn’t load your ledger.
        </p>
        <Button onClick={() => void ledger.refetch()}>Try again</Button>
      </Centered>
    );
  }
  if (!ready) return <Loading />;

  return (
    <>
      {children}
      {syncError ? (
        <div
          role="alert"
          className="panel fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center justify-between gap-3 md:bottom-6"
        >
          <p className="text-sm">{syncError} Your screen was put back to what the server has.</p>
          <Button variant="secondary" onClick={() => useLedger.getState().clearSyncError()}>
            OK
          </Button>
        </div>
      ) : null}
    </>
  );
}
