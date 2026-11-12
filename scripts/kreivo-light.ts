/** Count a community's members through the app's own Kreivo light client, and
 *  compare with the collective's explorer. Start the light client on a socket first:
 *    cd src-tauri && HUB_NET=kreivo HUB_PORT=9956 cargo test --lib hub::tests::bridge -- --ignored --nocapture
 *  then: bun run scripts/kreivo-light.ts <community> [explorer base] [port] */
import { connect as tcp } from "node:net";
import { createClient } from "polkadot-api";
import { countMembers } from "../src/lib/kreivo";

const community = Number(process.argv[2] ?? 12);
const base = process.argv[3] ?? "https://www.decent.partners";
const port = Number(process.argv[4] ?? 9956);

const client = createClient((onMessage) => {
  const sock = tcp(port, "127.0.0.1");
  let buf = "";
  sock.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onMessage(line);
    }
  });
  return { send: (m) => sock.write(m.replace(/\n/g, " ") + "\n"), disconnect: () => sock.destroy() };
});

const t0 = Date.now();
const here = await countMembers(client, community);
console.log(`light client: ${here.count} members (${here.memberships} memberships) of community ${community} at block ${here.block}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const ex = await fetch(`${base}/api/explorer`, { headers: { Accept: "application/json" } }).then((r) => r.json()).catch(() => null);
const g = ex?.group;
if (g?.community === community) console.log(`explorer:     ${g.members.count} members (${g.members.memberships} memberships) at block ${g.block.number}`);
client.destroy();
process.exit(g && g.community === community && g.members.count !== here.count ? 1 : 0);
