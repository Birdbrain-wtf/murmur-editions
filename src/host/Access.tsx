import { useState } from "react";
import { Check } from "lucide-react";
import type { Identity } from "./types";
import { edition } from "../edition";
import { getModule } from "./registry";
import { approve } from "../identity/participation";
import { Button, Notice, Status, inputClass } from "../ui";
import { LEVELS, LEVEL_LABEL, LEVEL_LINE, propose, useAccess, type Draft, type Level } from "../lib/access";

/**
 * Plugins → Who can use what, live (editions with `access`, lib/access.ts). The
 * demo editions show a sample instead (demo/access.tsx).
 *
 * Every member can read the grid and propose a change. A proposal is signed with
 * the check-in key and filed with the collective's own server; nothing changes
 * until whoever the collective's stage says decides has approved it (its operator
 * while incubated, then a trusted group, then its own governance).
 */

const STATUS: Record<string, { tone: "ok" | "danger" | "idle"; label: string }> = {
  waiting: { tone: "idle", label: "waiting" },
  approved: { tone: "ok", label: "approved" },
  declined: { tone: "danger", label: "declined" },
};

export function LiveAccess({ installed, identity }: { installed: string[]; identity: Identity }) {
  const [n, setN] = useState(0);
  const { grid, me, error } = useAccess(identity.session, n);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; turnOn?: boolean } | null>(null);
  const name = edition.instance.name;

  if (error && !grid) return <Notice tone="danger">{error}</Notice>;
  if (!grid) return <p className="px-1 text-xs text-[var(--faint)]">Reading {name}'s grid.</p>;

  const rows = Object.keys(grid.plugins).filter((id) => installed.includes(id) && getModule(id));
  const elsewhere = Object.entries(grid.elsewhere).filter(([id]) => installed.includes(id) && getModule(id));
  const roleName = (id: string) => grid.roles.find((r) => r.id === id)?.name ?? id;
  const proposals = me?.proposals ?? grid.proposals;

  async function send() {
    if (!draft) return;
    setBusy(true);
    setNote(null);
    const r = await propose(draft);
    setBusy(false);
    if (!r.ok) return setNote({ ok: false, text: r.error, turnOn: r.needsCheckIns });
    setNote({ ok: true, text: r.already ? "That change is already proposed." : `Proposed: ${r.what}. ${grid!.approvers} decides it.` });
    setDraft(null);
    setN((x) => x + 1);
  }

  async function turnOn() {
    if (!identity.session) return;
    setBusy(true);
    try {
      await approve(identity.session);
      setNote(null);
      await send();
    } catch (e: any) {
      setNote({ ok: false, text: e?.message || "The approval did not finish." });
      setBusy(false);
    }
  }

  const signedIn = !!identity.session;

  return (
    <div className="flex flex-col gap-5">
      <p className="px-1 text-[13px] leading-relaxed text-[var(--muted)]">
        Each plugin has a level for each role. {signedIn ? "Tap a level to propose changing it." : "Sign in to propose a change."}{" "}
        {grid.approvers} decides, and every change is recorded.
      </p>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--line)]">
        <table className="w-full min-w-[26rem] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--line)]">
              <th className="px-3 py-2.5 font-normal text-[var(--faint)]">Plugin</th>
              {grid.roles.map((r) => (
                <th key={r.id} className="px-2 py-2.5 align-bottom font-normal" title={r.line}>
                  <div className="font-tight text-[13px] font-medium text-[var(--fg)]">{r.name}</div>
                  <div className="text-[11px] text-[var(--faint)]">{r.default ? "everyone signed in" : `${r.holders ?? 0} ${r.holders === 1 ? "person" : "people"}`}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((id) => {
              const m = getModule(id)!;
              const Icon = m.icon;
              return (
                <tr key={id} className="border-b border-[var(--line)] last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                      <span className="font-tight text-[13px]">{m.title}</span>
                    </span>
                  </td>
                  {grid.roles.map((r) => {
                    const l: Level = grid.plugins[id][r.id] ?? "none";
                    const fixed = r.id === "operator";
                    const picked = draft?.what === "level" && draft.plugin === id && draft.role === r.id;
                    return (
                      <td key={r.id} className="px-2 py-2">
                        <button
                          disabled={!signedIn || fixed}
                          onClick={() => {
                            setNote(null);
                            setDraft({ what: "level", plugin: id, role: r.id, level: l, why: "" });
                          }}
                          title={fixed ? "The operator runs everything while incubating." : `${r.name}: ${LEVEL_LABEL[l]}, ${LEVEL_LINE[l]}.`}
                          data-level={l}
                          data-picked={picked}
                          className="prism-hover whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11px] transition disabled:cursor-default data-[level=none]:border-dashed data-[level=none]:border-[var(--line)] data-[level=none]:text-[var(--faint)] data-[level=see]:border-[var(--line-strong)] data-[level=see]:text-[var(--muted)] data-[level=join]:border-[var(--line-strong)] data-[level=join]:text-[var(--fg)] data-[level=run]:border-[var(--fg)] data-[level=run]:text-[var(--fg)] data-[picked=true]:outline data-[picked=true]:outline-1 data-[picked=true]:outline-offset-2"
                        >
                          {LEVEL_LABEL[l]}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {elsewhere.map(([id, line]) => {
              const m = getModule(id)!;
              const Icon = m.icon;
              return (
                <tr key={id} className="border-b border-[var(--line)] last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                      <span className="font-tight text-[13px]">{m.title}</span>
                    </span>
                  </td>
                  <td colSpan={grid.roles.length} className="px-2 py-2 text-[12px] text-[var(--faint)]">
                    {line}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {draft?.what === "level" && (
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--line-strong)] px-4 py-3">
          <div className="font-tight text-sm font-medium">
            {roleName(draft.role)} on {getModule(draft.plugin)?.title ?? draft.plugin}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setDraft({ ...draft, level: l })}
                data-active={draft.level === l}
                title={LEVEL_LINE[l]}
                className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)] data-[active=true]:border-[var(--fg)] data-[active=true]:text-[var(--fg)]"
              >
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
          <Why value={draft.why} onChange={(why) => setDraft({ ...draft, why })} />
          <Actions
            busy={busy}
            disabled={draft.level === grid.plugins[draft.plugin]?.[draft.role]}
            onSend={send}
            onCancel={() => setDraft(null)}
          />
        </div>
      )}

      <section className="flex flex-col gap-2">
        <div className="px-1 font-tight text-sm font-medium">Roles</div>
        <ul className="flex flex-col gap-1 px-1 text-[13px]">
          {grid.roles.map((r) => (
            <li key={r.id}>
              <span className="font-medium">{r.name}</span> <span className="text-[var(--muted)]">{r.line}.</span>
              {me?.people && !r.default && (
                <span className="text-[var(--faint)]">
                  {" "}
                  {(() => {
                    const held = me.people.filter((p) => p.roles.includes(r.id)).map((p) => p.userId);
                    return held.length ? `Held by ${held.join(", ")}.` : "Nobody yet.";
                  })()}
                </span>
              )}
            </li>
          ))}
        </ul>
        {signedIn && draft?.what !== "role" && (
          <Button
            variant="quiet"
            className="self-start"
            onClick={() => {
              setNote(null);
              setDraft({ what: "role", person: "", role: grid.roles.find((r) => !r.default && r.id !== "operator")?.id ?? grid.roles[0].id, add: true, why: "" });
            }}
          >
            Propose someone for a role
          </Button>
        )}
        {draft?.what === "role" && (
          <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--line-strong)] px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Add or take out"
                value={draft.add ? "add" : "remove"}
                onChange={(e) => setDraft({ ...draft, add: e.target.value === "add" })}
                className={inputClass + " w-auto"}
              >
                <option value="add">Add</option>
                <option value="remove">Take out</option>
              </select>
              <input
                aria-label="Their handle"
                value={draft.person}
                onChange={(e) => setDraft({ ...draft, person: e.target.value.trim().toLowerCase() })}
                placeholder="their handle"
                className={inputClass + " w-40"}
              />
              <select aria-label="Role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className={inputClass + " w-auto"}>
                {grid.roles.filter((r) => !r.default).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <Why value={draft.why} onChange={(why) => setDraft({ ...draft, why })} />
            <Actions busy={busy} disabled={!/^[a-z0-9._-]{1,64}$/.test(draft.person)} onSend={send} onCancel={() => setDraft(null)} />
          </div>
        )}
      </section>

      {note && (
        <Notice tone={note.ok ? "ok" : "danger"}>
          <span className="flex flex-wrap items-center gap-3">
            {note.ok && <Check className="h-3.5 w-3.5" />}
            {note.text}
            {note.turnOn && (
              <Button variant="primary" busy={busy} onClick={() => void turnOn()}>
                Turn on check-ins and propose
              </Button>
            )}
          </span>
        </Notice>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2 px-1">
          <span className="font-tight text-sm font-medium">Proposed changes</span>
          <span className="text-xs text-[var(--faint)]">decided by {grid.approvers}</span>
        </div>
        {proposals.length ? (
          <ul className="flex flex-col divide-y divide-[var(--line)] rounded-[var(--radius)] border border-[var(--line)]">
            {proposals.slice(0, 20).map((p) => (
              <li key={p.id} className="flex flex-col gap-0.5 px-3 py-2 text-[13px]">
                <span className="flex flex-wrap items-center gap-x-3">
                  <span>{p.what}</span>
                  <Status tone={STATUS[p.status]?.tone ?? "idle"}>{STATUS[p.status]?.label ?? p.status}</Status>
                </span>
                <span className="text-[12px] text-[var(--faint)]">
                  {p.by}, {new Date(p.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  {p.why ? `: ${p.why}` : ""}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-xs text-[var(--faint)]">Nothing proposed yet.</p>
        )}
        <p className="px-1 text-[12px] leading-relaxed text-[var(--faint)]">
          {grid.line} Operations and Files keep the company's own list. The other plugins don't check these levels yet, so for
          now this is the agreed record of who may do what.
        </p>
      </section>
    </div>
  );
}

function Why({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      aria-label="Why"
      value={value}
      maxLength={500}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Why, in a sentence (optional)"
      className={inputClass}
    />
  );
}

function Actions({ busy, disabled, onSend, onCancel }: { busy: boolean; disabled: boolean; onSend: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <Button variant="primary" busy={busy} disabled={disabled} onClick={onSend}>
        Sign and propose
      </Button>
      <Button variant="quiet" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
