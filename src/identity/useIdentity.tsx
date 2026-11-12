import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Identity } from "../host/types";
import type { SignedIn } from "./passkey";
import { revoke } from "./participation";
import { checkSession, onSessionRejected } from "./session";

const KEY = "murmur.identity.v1";

const SIGNED_OUT: Identity = { handle: null, localId: null, did: null, signedIn: false };

function load(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const id = JSON.parse(raw) as Identity;
      // A passkey session that has run out signs the app out; the member signs in again.
      if (id.session && id.sessionExp && id.sessionExp < Date.now() / 1000) return { ...SIGNED_OUT, lapsedAs: id.handle };
      // A name typed before passkey sign-in existed proves nothing: ask again.
      if (id.signedIn && !id.session) return SIGNED_OUT;
      return id;
    }
  } catch {
    /* ignore */
  }
  return SIGNED_OUT;
}

function randomLocalId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface IdentityApi {
  identity: Identity;
  signIn: (who: SignedIn) => void;
  signOut: () => void;
}

const MATRIX_KEY = "murmur.matrix.session.v1";

const Ctx = createContext<IdentityApi | null>(null);

/**
 * Identity for the client, shared across the rail and the identity surface.
 *
 * Signing in is a passkey, approved in the member's own browser at the
 * edition's door (`passkey.ts`). What the app keeps is the door's session for
 * this app: who they are, never a key. `did:kreivo:…` attaches later.
 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity>(load);

  // Saved first, then announced, so anything listening (the operations console, lib/ops.ts)
  // reads the new session. signedOut carries the session that has just ended.
  const [ended, setEnded] = useState<string | undefined>();
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(identity));
    window.dispatchEvent(new CustomEvent("murmur:identity", { detail: { signedOut: ended } }));
    setEnded(undefined);
  }, [identity]);

  const signIn = useCallback((who: SignedIn) => {
    setIdentity((prev) => ({
      handle: who.displayName,
      localId: prev.localId ?? randomLocalId(),
      did: prev.did,
      signedIn: true,
      userId: who.userId,
      session: who.session,
      sessionExp: who.exp,
    }));
  }, []);

  // Signing out also switches check-ins off and forgets the chat login, so a
  // shared machine cannot go on recording, or talking as, the last person who
  // used it. Chat's account comes back with the passkey on the next sign-in.
  const signOut = useCallback(() => {
    void revoke(identity.session);
    localStorage.removeItem(MATRIX_KEY);
    setEnded(identity.session ?? undefined);
    setIdentity(SIGNED_OUT);
  }, [identity.session]);

  // The door no longer accepts this session: sign out of this collective only,
  // keeping the name so the next screen can say who to sign in again as. The
  // check-in key and chat login go too, as on sign-out.
  const current = useRef(identity);
  current.current = identity;
  const lapse = useCallback((session: string) => {
    const prev = current.current;
    if (prev.session !== session) return;
    void revoke(session);
    localStorage.removeItem(MATRIX_KEY);
    setEnded(session);
    setIdentity({ ...SIGNED_OUT, localId: prev.localId, lapsedAs: prev.handle });
  }, []);

  // Ask the door once when the window opens (switching collective reloads it),
  // and listen for any plugin the door has turned away.
  useEffect(() => {
    const s = identity.session;
    if (s) void checkSession(s).then((r) => r === "rejected" && lapse(s));
    return onSessionRejected(lapse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ identity, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIdentity(): IdentityApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIdentity must be used within IdentityProvider");
  return v;
}
