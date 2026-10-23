/**
 * The member's own Claude, on this computer (src-tauri/src/claude.rs).
 *
 * The agent can answer two ways. By default the collective's door answers with
 * its own model. If this computer has Claude Code, the member can choose "your
 * Claude" instead: the door still composes the prompt (its instructions, the app
 * guide, passages from its documents) and this runs it with the member's own
 * `claude`, on the member's own Claude subscription. The answer never goes back
 * to the door.
 *
 * Desktop only. In a browser there is no Claude Code to run, so `claudeStatus`
 * says not found and the choice never shows.
 */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ClaudeStatus {
  found: boolean;
  version?: string | null;
}

let cached: Promise<ClaudeStatus> | null = null;

/** Whether this computer has Claude Code. Asked once per window. */
export function claudeStatus(): Promise<ClaudeStatus> {
  if (!isTauri) return Promise.resolve({ found: false });
  cached ??= import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<ClaudeStatus>("claude_status"))
    .catch(() => ({ found: false }));
  return cached;
}

/** One line of Claude Code's stream-json output, the parts used here. */
interface StreamLine {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
}

/**
 * Run one prompt with the member's own Claude. Resolves with the whole answer;
 * `onToken` sees it arrive. Aborting the signal stops the program.
 */
export async function askClaude(opts: {
  system: string;
  prompt: string;
  onToken: (t: string) => void;
  signal: AbortSignal;
}): Promise<string> {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
  const id = crypto.randomUUID();
  let text = "";
  let failure = "";
  const off: { fn?: () => void } = {};
  const stop = () => void invoke("claude_stop", { id }).catch(() => {});
  try {
    return await new Promise<string>((resolve, reject) => {
      if (opts.signal.aborted) return reject(new DOMException("stopped", "AbortError"));
      opts.signal.addEventListener("abort", () => {
        stop();
        reject(new DOMException("stopped", "AbortError"));
      });
      listen<{ id: string; line?: string | null; end?: { ok: boolean; error: string } | null }>("claude", (e) => {
        if (e.payload.id !== id) return;
        if (e.payload.line) {
          let d: StreamLine;
          try {
            d = JSON.parse(e.payload.line);
          } catch {
            return;
          }
          if (d.type === "stream_event" && d.event?.type === "content_block_delta" && d.event.delta?.type === "text_delta") {
            const t = d.event.delta.text ?? "";
            text += t;
            opts.onToken(t);
          }
          if (d.type === "result" && d.is_error) failure = d.result || d.subtype || "Claude could not answer.";
          if (d.type === "result" && !d.is_error && typeof d.result === "string" && d.result.trim()) text = d.result;
        }
        if (e.payload.end) {
          if (text.trim() && !failure) resolve(text);
          else reject(new Error(plain(failure || e.payload.end.error)));
        }
      })
        .then((u) => {
          off.fn = u;
          return invoke("claude_ask", { id, system: opts.system, prompt: opts.prompt });
        })
        .catch((e) => reject(new Error(plain(String(e)))));
    });
  } finally {
    off.fn?.();
  }
}

/** Claude Code's own errors, said the way a member can act on them. */
function plain(raw: string): string {
  const s = raw.trim();
  if (/log ?in|logged out|authenticat|\/login|oauth|credential/i.test(s)) {
    return "Claude Code on this computer is not signed in. Open Terminal, run claude, and sign in with your Claude account, then ask again.";
  }
  if (/rate|limit|usage|quota/i.test(s)) return "Your Claude plan has reached its limit for now. Switch back to the group's own model, or try later.";
  if (/not installed/i.test(s)) return "Claude Code is not installed on this computer.";
  return s ? `Claude could not answer: ${s.slice(-240)}` : "Claude could not answer just now. Try again.";
}
