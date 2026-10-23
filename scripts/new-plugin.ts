#!/usr/bin/env bun
/**
 * Scaffold a new plugin.
 *
 *   bun run new-plugin <id>      # id is kebab-case, e.g. "ledger" or "good-news"
 *
 * Writes src/plugins/<id>/index.tsx with a minimal, valid MurmurModule. The
 * registry auto-discovers it (import.meta.glob over src/plugins/*), so there is
 * nothing else to wire — start `bun run dev` and the plugin shows in the catalog.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const id = process.argv[2];

if (!id) {
  console.error("usage: bun run new-plugin <id>   (kebab-case, e.g. ledger)");
  process.exit(1);
}
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) {
  console.error(`invalid id "${id}" — use kebab-case: ^[a-z][a-z0-9-]*$`);
  process.exit(1);
}

const dir = join(process.cwd(), "src", "plugins", id);
if (existsSync(dir)) {
  console.error(`plugin already exists: src/plugins/${id}/`);
  process.exit(1);
}

const title = id
  .split("-")
  .map((s) => s[0].toUpperCase() + s.slice(1))
  .join(" ");
const exportName =
  id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()) + "Plugin";

const tpl = `import { Puzzle } from "lucide-react";
import type { MurmurModule, PluginContext } from "../../host/types";
import { issues } from "../../host/support";
import { Page, PageHeader, PageBody, Card } from "../../ui";

/**
 * ${title} plugin: TODO describe what this binds to and does.
 * Draw everything from src/ui (Page, PageHeader, PageBody, Section, Card,
 * Row, Button, Field, Gate, Status). Don't hand-roll headers or buttons.
 */
function Panel({ identity }: PluginContext) {
  return (
    <Page>
      <PageHeader
        icon={Puzzle}
        eyebrow="${id}"
        title="${title}"
        lede="New plugin scaffold. Replace this panel with the real surface."
      />
      <PageBody>
        <Card tone="dashed">
          Wire up <span className="font-mono">${id}</span> here.
          {identity.handle ? \` Signed in as \${identity.handle}.\` : ""}
        </Card>
      </PageBody>
    </Page>
  );
}

export const ${exportName}: MurmurModule = {
  id: "${id}",
  title: "${title}",
  tagline: "TODO: one-line description for the catalog",
  icon: Puzzle,
  // ordering weight in the rail (lower = higher). Existing: understand 10,
  // chat 20, pay 25, meet 30, watch 35, contact 40, network 50. Adjust to taste.
  order: 60,
  kind: "plugin",
  // early and for testing until it is ready for real use; drop this when it is
  lab: true,
  // where help and bug reports for this plugin go (issues, or email for a private plugin)
  support: issues("${id}"),
  // backend: "Sovereign target this binds to",
  Panel,
};
`;

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "index.tsx"), tpl);

console.log(`✓ created src/plugins/${id}/index.tsx  (export: ${exportName})`);
console.log("  auto-discovered by the registry — run `bun run dev` to see it.");
console.log("  next: set order/backend, build the Panel, then `bun run build` to type-check.");
console.log("  then offer it: add the id to an edition's `custom` (made for that collective) or `plugins` (market) in src/edition.ts.");
