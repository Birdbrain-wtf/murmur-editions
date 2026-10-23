import { edition } from "../edition";
import { accessSupported, useAccess } from "./access";
import { useOps } from "./ops";

/**
 * Which of the installed plugins this sign-in can actually use, so the home
 * screen and the rail only show those.
 *
 * Two lists decide, and the app never widens either:
 *   the operations console's own list (owners, support, investors) decides
 *     Operations and Files. They stay hidden until the console has said yes,
 *     and Files stays hidden from an investor, whose documents are in Operations.
 *   the collective's grid (lib/access.ts), where it has one, hides any plugin
 *     whose level for this person is "No access".
 *
 * Hiding is presentation only. Every plugin still checks on its own server.
 *
 * `pairable`: the console could not tell who this is, but a console passkey of
 * its own might open it (an edition whose console does not take the app's
 * sign-in). The home screen offers that sign-in quietly instead of the cards.
 */
const CONSOLE_PLUGINS = ["operations", "files"];

export function useReach(installed: string[], session: string | null | undefined) {
  const ops = useOps();
  const { me } = useAccess(accessSupported ? session : null);

  const opsMe = ops.kind === "ready" ? ops.me : null;
  const visible = installed.filter((id) => {
    if (CONSOLE_PLUGINS.includes(id)) {
      if (!opsMe) return false;
      if (id === "files" && opsMe.role === "investor") return false;
    }
    if (me && me.levels[id] === "none") return false;
    return true;
  });

  const pairable =
    !opsMe &&
    !!edition.ops &&
    !edition.ops.member &&
    !!session &&
    (ops.kind === "signed-out" || ops.kind === "pairing") &&
    installed.some((id) => CONSOLE_PLUGINS.includes(id));

  return { visible, pairable };
}
