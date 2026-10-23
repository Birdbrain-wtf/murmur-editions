import { useEffect, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { collectives, edition } from "../../edition";
import { joinCollective, switchCollective, joinedCollectives } from "../../host/scope";
import type { MurmurPlugin, PluginContext } from "../../host/types";
import { email } from "../../host/support";
import { openInBrowser } from "../../identity/passkey";
import { PasskeySignIn } from "../../identity/SignIn";
import { sessionRejected } from "../../identity/session";
import { useIdentity } from "../../identity/useIdentity";
import { Button, PageBody } from "../../ui";
import { demoNote } from "../../demo/note";

/**
 * Watch: the Four To The Floor channel, inside the app (rich, 2026-10-17).
 *
 * The screen is Flipside, FTTF's Lab 06 (`orbits/fttf/site/lab/06-flipside/`),
 * served for the app at `<origin>/watch/`: a channel already on air, and the
 * people behind it when the screen turns round. The plugin frames it edge to
 * edge and adds nothing of its own.
 *
 * Sign-in stays the app's. The frame never asks for a passkey: the app hands it
 * the session it already holds (email or passkey at FTTF's door, approved through
 * /app/link), by message to FTTF's origin only, and again whenever it changes.
 * The frame's "Sign in" opens the app's own sign-in here; a session the door
 * refuses signs the app out of FTTF as any other plugin would. Links that leave
 * the channel open in the member's browser, so the picture keeps playing.
 *
 * In FTTF's sketch (edition fttfdemo, 2026-10-18) the same plugin sits in the rail
 * after what was made for the crew, plays as a guest, and a press on the frame's
 * "Sign in" only says what it would do, as every other door in a sketch does.
 *
 * In any other collective's window (Birdbrain, Decent: offered there to add,
 * 2026-10-17) the channel plays as a guest. That window's session is the other
 * collective's, so it is never handed to FTTF's origin, and a door refusing
 * nothing signs nobody out. The frame's "Sign in" offers FTTF's own space
 * instead (added beside this one where the app can open it), or FTTF's site.
 */
const ORIGIN = "https://fttf.decent.partners";
const CHANNEL_URL = `${ORIGIN}/watch/`;
const HOME = edition.id === "fttf";
const canOpenFttf = collectives.some((c) => c.id === "fttf");

function Panel({ identity }: PluginContext) {
  const { signIn } = useIdentity();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const session = HOME && identity.signedIn ? identity.session ?? null : null;
  const current = useRef(session);
  current.current = session;

  function send() {
    frame.current?.contentWindow?.postMessage({ type: "fttf:session", session: current.current }, ORIGIN);
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== ORIGIN || e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (!m || typeof m.type !== "string") return;
      if (m.type === "fttf:ready") send();
      else if (m.type === "fttf:sign-in") {
        // In a sketch (FTTF's own, one rung back) there are no logins yet: say what would happen.
        if (edition.demo) demoNote("In your own app this opens Four To The Floor's sign-in, email or passkey at its own door. The channel keeps playing.");
        else setAsking(true);
      }
      else if (m.type === "fttf:session-rejected") {
        if (HOME) sessionRejected(current.current);
      }
      else if (m.type === "fttf:open" && typeof m.url === "string" && m.url.startsWith("https://")) void openInBrowser(m.url);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    send();
    if (session) setAsking(false);
  }, [session]);

  return (
    <div className="relative h-full min-h-0 bg-[#070907]">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#8a9186]">On air</div>
        </div>
      )}
      <iframe
        ref={frame}
        src={CHANNEL_URL}
        title="Four To The Floor"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        onLoad={() => setLoaded(true)}
        className="h-full w-full border-0"
        style={{ opacity: loaded ? 1 : 0, transition: "opacity .4s ease" }}
      />
      {asking && !HOME && (
        <div className="absolute inset-0 z-10 overflow-auto bg-background/95">
          <div className="flex justify-end p-3">
            <Button variant="quiet" icon={X} onClick={() => setAsking(false)}>
              Back to the channel
            </Button>
          </div>
          <PageBody width="read">
            <h2 className="text-xl font-semibold">Sign in to Four To The Floor</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              You are watching as a guest from {edition.instance.name}. Four To The Floor keeps its own members and its own
              sign-in, so joining in happens in its space, not this one.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {canOpenFttf && (
                <Button
                  variant="primary"
                  onClick={() => (joinedCollectives().includes("fttf") ? switchCollective("fttf") : joinCollective("fttf"))}
                >
                  {joinedCollectives().includes("fttf") ? "Open Four To The Floor" : "Add Four To The Floor"}
                </Button>
              )}
              <Button variant={canOpenFttf ? "secondary" : "primary"} onClick={() => void openInBrowser(ORIGIN)}>
                Go to their site
              </Button>
            </div>
          </PageBody>
        </div>
      )}
      {asking && HOME && !session && (
        <div className="absolute inset-0 z-10 overflow-auto bg-background/95">
          <div className="flex justify-end p-3">
            <Button variant="quiet" icon={X} onClick={() => setAsking(false)}>
              Back to the channel
            </Button>
          </div>
          <PageBody width="read">
            <PasskeySignIn
              onSignedIn={signIn}
              title="Sign in to Four To The Floor"
              lede={
                identity.lapsedAs
                  ? `Four To The Floor no longer accepts the sign-in this app held for ${identity.lapsedAs}. Sign in again and the channel carries on where it was.`
                  : "Sign in with your email or your passkey, the same way as on the site. The channel keeps playing behind this."
              }
            />
          </PageBody>
        </div>
      )}
    </div>
  );
}

export const watchPlugin: MurmurPlugin = {
  id: "watch",
  title: "Watch",
  tagline: "Four To The Floor: the channel",
  icon: Play,
  order: 5,
  kind: "plugin",
  support: email("watch"),
  backend: "fttf.decent.partners/watch (Flipside)",
  Panel,
};
