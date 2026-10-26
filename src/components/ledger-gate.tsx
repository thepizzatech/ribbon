import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Mark } from "@/components/mark";
import { ImportPrompt, LoginForm, SetupFlow } from "@/components/auth";
import { WelcomeSetup } from "@/components/welcome";
import { Button } from "@/components/ui";
import { api, onUnauthorized, type Session } from "@/lib/gifts/api";
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

/** Signs in (or runs first-time setup), loads the ledger from the server and keeps the store in step with it. */
export function LedgerGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const ready = useLedger((state) => state.ready);
  const syncError = useLedger((state) => state.syncError);
  const [importResolved, setImportResolved] = useState(false);

  const session = useQuery({ queryKey: SESSION_KEY, queryFn: api.session, refetchOnWindowFocus: false });
  const signedIn = Boolean(session.data?.authed);
  // The owner's first sign-in lands on the Welcome setup; the server keeps the ledger closed until it is done.
  const welcome = signedIn && session.data?.welcomeRequired === true;

  const ledger = useQuery({
    queryKey: LEDGER_KEY,
    queryFn: api.ledger,
    enabled: signedIn && !welcome,
  });

  function accept(next: Session) {
    queryClient.setQueryData(SESSION_KEY, next);
    setImportResolved(false);
    void queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
  }

  // Any 401 means the session ended: show the sign-in screen again.
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

  // A ledger that older versions kept in this browser is only offered, never pushed up on its own,
  // and only when the server has no real gifts yet (so a family already using Ribbon is never overwritten).
  const [offer, setOffer] = useState<ReturnType<typeof readLocalLedger>>(null);
  const firstLoad = ledger.isSuccess;
  // Real data on the server (gifts that are not the sample household) is never overwritten.
  const serverHasRealData = Boolean(ledger.data && ledger.data.gifts.length > 0 && !ledger.data.demo);
  useEffect(() => {
    if (!firstLoad || importResolved) return;
    if (alreadyHandled()) return setImportResolved(true);
    const local = readLocalLedger();
    if (!local) {
      markHandled("none");
      return setImportResolved(true);
    }
    if (local.demo || local.gifts.length === 0) {
      markHandled("skipped"); // only the sample household, or nothing worth moving
      return setImportResolved(true);
    }
    if (serverHasRealData) {
      markHandled("skipped"); // the server already holds real data; never overwrite it
      return setImportResolved(true);
    }
    setOffer(local);
  }, [firstLoad, importResolved, serverHasRealData]);

  // Mirror the server's copy into the store, unless local changes are still on their way up.
  useEffect(() => {
    if (!ledger.data || !importResolved || pendingChanges() > 0) return;
    useLedger.getState().applyServer(ledger.data);
  }, [ledger.data, importResolved]);

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
  if (session.data.setupRequired) return <SetupFlow session={session.data} onDone={accept} />;
  if (!signedIn) return <LoginForm session={session.data} onDone={accept} />;
  if (welcome) {
    return (
      <WelcomeSetup
        username={session.data.user?.displayName || session.data.user?.username || ""}
        onDone={async () => {
          // Setup is saved: reload the session (it now says the welcome is done) and open the empty Overview. The tour follows.
          accept(await api.session());
        }}
        onSignOut={() => {
          void api.logout().finally(() => {
            queryClient.removeQueries({ queryKey: ["welcome"] });
            void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
          });
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
  if (offer && !importResolved) {
    return (
      <ImportPrompt
        summary={`${offer.gifts.length} gift${offer.gifts.length === 1 ? "" : "s"} and ${offer.people.length} ${offer.people.length === 1 ? "person" : "people"}`}
        replacing={Boolean(ledger.data?.demo)}
        onSkip={() => {
          markHandled("skipped");
          setImportResolved(true);
        }}
        onImport={async () => {
          const result = await api.importLedger(offer);
          queryClient.setQueryData(LEDGER_KEY, result);
          markHandled("imported");
          setImportResolved(true);
        }}
      />
    );
  }
  // Signed in, ledger still on its way: show the app frame (sidebar, header, tab bar) right away.
  // The Shell leaves the page itself empty until the ledger arrives, so nothing flashes "empty".

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
