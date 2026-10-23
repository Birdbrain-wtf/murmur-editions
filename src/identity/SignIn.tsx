import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Fingerprint, X } from "lucide-react";
import { edition } from "../edition";
import { openInBrowser, startPairing, type Pairing, type SignedIn } from "./passkey";
import { Button, Code, Gate, Notice, Waiting } from "../ui";

/**
 * Sign in with a passkey, in the browser. The app shows the code it asked for,
 * opens the door's approval page, and waits for the member to say yes there.
 */
export function PasskeySignIn({
  onSignedIn,
  title = "Sign in with your passkey",
  lede,
}: {
  onSignedIn: (who: SignedIn) => void;
  title?: string;
  lede?: string;
}) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<Pairing | null>(null);
  const site = new URL(edition.signIn.approve).host;

  useEffect(() => () => live.current?.cancel(), []);

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      const p = await startPairing();
      live.current = p;
      setPairing(p);
      await openInBrowser(p.url);
      const who = await p.done;
      onSignedIn(who);
    } catch (e: any) {
      if (e?.message !== "cancelled") setError(e?.message || "That did not work. Try again.");
      setPairing(null);
    } finally {
      setBusy(false);
      live.current = null;
    }
  }

  function cancel() {
    live.current?.cancel();
    setPairing(null);
  }

  if (!pairing)
    return (
      <Gate
        icon={Fingerprint}
        title={title}
        action={
          <Button variant="primary" size="md" onClick={begin} busy={busy} trailing={ArrowRight}>
            {busy ? "Opening your browser" : "Sign in with your passkey"}
          </Button>
        }
      >
        {lede && <p>{lede}</p>}
        <p>
          Your browser opens {site}. Approve with your passkey and come back signed in.
        </p>
        {error && <Notice tone="danger">{error}</Notice>}
      </Gate>
    );

  return (
    <Gate
      icon={Fingerprint}
      title="Approve in your browser"
      action={
        <>
          <Button onClick={() => openInBrowser(pairing.url)} trailing={ArrowUpRight}>
            Open the page again
          </Button>
          <Button variant="quiet" icon={X} onClick={cancel}>
            Cancel
          </Button>
        </>
      }
    >
      <p>
        Check {site} shows this code, then approve with your passkey. A different code means
        someone else started it. Don't approve.
      </p>
      <Code>
        {pairing.code.slice(0, 4)}-{pairing.code.slice(4)}
      </Code>
      <Waiting>Waiting for you to approve</Waiting>
    </Gate>
  );
}
