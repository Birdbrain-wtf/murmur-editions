import type { Support } from "./types";

/**
 * The specific route back for each plugin: help, bugs, support. The general
 * Suggest button feeds the backlog; this is where a person gets an answer.
 *
 * - `issues(id)` for plugins in the open repo: a new issue on
 *   github.com/Birdbrain-wtf/murmur, titled with the plugin so it can be found.
 * - `email(id)` for plugins that stay private (Operations, Files, FTTF's own):
 *   a mail to Decent with the plugin in the subject.
 */

const REPO = "https://github.com/Birdbrain-wtf/murmur";
const DECENT = "hello@decent.partners";

export function issues(id: string): Support {
  const q = new URLSearchParams({ title: `[${id}] ` });
  return { label: "Report it on GitHub", href: `${REPO}/issues/new?${q}` };
}

export function email(id: string, to = DECENT): Support {
  return { label: `Email ${to}`, href: `mailto:${to}?subject=${encodeURIComponent(`[${id}] `)}` };
}
