import { useSyncExternalStore } from "react";
import { edition, packed } from "../edition";
import { openInBrowser } from "../identity/passkey";

/**
 * In a demo edition, a button that would reach a server we have not built yet
 * (the console, a call, a door) says what it would do instead. `DemoBar` shows
 * the line for a few seconds.
 */
let current: { text: string; at: number } | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function demoNote(text: string) {
  current = { text, at: Date.now() };
  listeners.forEach((l) => l());
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    listeners.forEach((l) => l());
  }, 6000);
}

export function useDemoNote() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** What the demo's way onward is called: logins for a real collective, or, in
 *  an invented one (`showcase`), an app for the visitor's own group. */
export const askLabel = edition.showcase && !packed ? "Get one for your group" : "Ask for logins";

/** Where a collective asks for its logins: the next rung of the incubation path.
 *  From an invented one, it asks for an app of the visitor's own. */
export function askForLogins() {
  const name = edition.instance.name;
  const invented = edition.showcase && !packed;
  const subject = invented ? "An app for our group" : `Logins for ${name}`;
  const body = invented
    ? `Hello Decent,\n\nWe've tried the ${name} demo and would like an app like it for our own group.\n\nWho we are:\n\n`
    : `Hello Decent,\n\nWe've tried the ${edition.productName} demo and would like logins for our members.\n\nWho should have one:\n\n`;
  void openInBrowser(
    `mailto:hello@decent.partners?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  );
}
