#!/usr/bin/env bun
/**
 * Put a version's release notes on GitHub, so every release is tracked there
 * with the same words members saw in the app's update prompt.
 *
 *   bun run github-release [version]        # default: the version in package.json
 *
 * The notes are the `notes` field of each channel's latest.json, written by
 * finish-release. They are read back from this repo's git history, so an older
 * version can be published later with the words it actually shipped with.
 *
 * Two places, because the editions are not equally public:
 *   1. Decent-Partners/murmur-editions (private): one release per version, a
 *      section per edition that shipped it. Its tag points at the snapshot
 *      cloud-build pushed for this version, so run this after finish-release and
 *      before the next cloud-build (finish-release runs it for you). Later
 *      snapshots are force-pushed over main; the tag keeps this one.
 *   2. Birdbrain-wtf/murmur (public, the open core): Birdbrain's notes go on the
 *      release its own workflow creates when the open core is tagged. Run this
 *      again after that tag if the release did not exist yet.
 *
 * Idempotent: an existing release has its text replaced, never a duplicate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITIONS } from "./editions";

const root = new URL("..", import.meta.url).pathname;
const PRIVATE = "Decent-Partners/murmur-editions";
const PUBLIC = "Birdbrain-wtf/murmur";
const MAC_NOTE =
  "Murmur for macOS (Apple silicon and Intel). Ad-hoc signed, not notarised: see https://birdbrain.wtf/murmur for the one-time step to open it.";

const version =
  process.argv[2]?.replace(/^v/, "") ||
  (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
const tag = `v${version}`;

// The stored gh login has the rights; a GITHUB_TOKEN in the environment does not.
const env = { ...process.env };
delete env.GITHUB_TOKEN;
const gh = (args: string[], input?: string) =>
  execFileSync("gh", args, { env, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();
const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const exists = (repo: string) => {
  try {
    gh(["release", "view", tag, "-R", repo, "--json", "tagName"]);
    return true;
  } catch {
    return false;
  }
};

/** The notes an edition shipped this version with, from the newest commit of its latest.json that names it. */
function notesFor(dir: string): string | null {
  const file = `${dir}/latest.json`;
  for (const sha of git(["log", "--format=%H", "--", file]).split("\n").filter(Boolean)) {
    try {
      const j = JSON.parse(git(["show", `${sha}:${file}`]));
      if (j.version === version) return String(j.notes || "").trim() || null;
    } catch {
      /* not JSON at that commit */
    }
  }
  return null;
}

const shipped = Object.entries(EDITIONS)
  .map(([id, e]) => ({ id, product: e.product, notes: notesFor(e.dir) }))
  .filter((x): x is { id: string; product: string; notes: string } => !!x.notes);
if (!shipped.length) {
  console.error(`No edition's channel has shipped ${tag} (no latest.json in git history names it).`);
  process.exit(1);
}
const held = Object.values(EDITIONS)
  .filter((e) => !shipped.some((s) => s.product === e.product))
  .map((e) => `- ${e.product}: not in this release${e.held ? `, ${e.held}` : ""}.`);

// 1. The private editions repo: every edition.
{
  const body = [
    ...shipped.map((s) => `## ${s.product}\n\n${s.notes}`),
    held.length ? `## Not shipped\n\n${held.join("\n")}` : "",
    "Built by cloud-build from lab/murmur and signed on Zo with each edition's own key. The signed files are served from each edition's update channel, not attached here.",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (exists(PRIVATE)) {
    gh(["release", "edit", tag, "-R", PRIVATE, "--notes-file", "-"], body);
    console.log(`✓ ${PRIVATE} ${tag}: notes replaced`);
  } else {
    const snap = gh(["api", `repos/${PRIVATE}/commits/main`, "-q", ".commit.message"]);
    if (!snap.startsWith(`${tag} `)) {
      console.log(`· ${PRIVATE}: main is "${snap.split(":")[0]}", not the ${tag} snapshot, so no release there (tag it by hand if needed)`);
    } else {
      gh(["release", "create", tag, "-R", PRIVATE, "--target", "main", "--title", `${tag}`, "--notes-file", "-"], body);
      console.log(`✓ ${PRIVATE} ${tag}: release created`);
    }
  }
}

// 2. The public open core: Birdbrain's notes only.
{
  const bb = shipped.find((s) => s.id === "murmur");
  if (!bb) console.log(`· ${PUBLIC}: Birdbrain did not ship ${tag}, left alone`);
  else if (!exists(PUBLIC))
    console.log(`· ${PUBLIC}: no ${tag} release yet. Tag the open core (murmur-oss), then run this again.`);
  else {
    gh(["release", "edit", tag, "-R", PUBLIC, "--notes-file", "-"], `${bb.notes}\n\n${MAC_NOTE}`);
    console.log(`✓ ${PUBLIC} ${tag}: Birdbrain's notes on the release`);
  }
}
