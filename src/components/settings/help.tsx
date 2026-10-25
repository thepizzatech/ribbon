import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import { startTour } from "@/lib/tour";
import { useInstall } from "@/lib/pwa";
import { useSession } from "@/lib/gifts/use-session";
import { versionLabel } from "@/lib/version";

export function HelpTab() {
  const navigate = useNavigate();
  const session = useSession();
  const install = useInstall();
  const s = session.data;
  return (
    <div className="settings-grid">
      <section className="card stack" aria-labelledby="tour-title">
        <div>
          <h2 className="card-title" id="tour-title">
            Guided tour
          </h2>
          <p className="card-sub">A quick look around: seven short stops. Skip any time.</p>
        </div>
        <Button
          onClick={() =>
            void startTour({
              beforeStart: async () => {
                await navigate({ to: "/" });
                await new Promise((resolve) => setTimeout(resolve, 250));
              },
            })
          }
        >
          Replay the tour
        </Button>
      </section>

      <section className="card stack install-hint" aria-labelledby="install-title">
        <div>
          <h2 className="card-title" id="install-title">
            Install Ribbon
          </h2>
          <p className="card-sub">Add it to your home screen or desktop so it opens like an app.</p>
        </div>
        {install.installed ? (
          <p className="text-sm">Ribbon is installed on this device.</p>
        ) : install.canPrompt ? (
          <Button variant="secondary" onClick={() => void install.prompt()}>
            Install this app
          </Button>
        ) : install.ios ? (
          <p className="text-sm">On iPhone or iPad: tap Share, then “Add to Home Screen”.</p>
        ) : !install.secure ? (
          <p className="notice">
            Browsers only offer installing over HTTPS (or on localhost). Once Ribbon is behind your reverse proxy with HTTPS, this button appears.
          </p>
        ) : (
          <p className="text-sm text-muted">Use your browser’s menu: “Install app” or “Add to Home Screen”.</p>
        )}
      </section>

      <section className="card stack" aria-labelledby="about-title">
        <h2 className="card-title" id="about-title">
          About
        </h2>
        <p className="text-sm text-muted">
          Ribbon {s ? `v${s.version}${s.commit ? ` (${s.commit})` : ""}` : versionLabel()}
          {s?.secure ? " · HTTPS" : ""}
        </p>
        <p className="text-sm text-muted">Asking a question sends the gift list to the assistant. Nothing is sent until you ask.</p>
        <a className="text-sm underline" href="https://github.com/thepizzatech/ribbon#readme" target="_blank" rel="noreferrer">
          Documentation
        </a>
      </section>
    </div>
  );
}
