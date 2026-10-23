import { useCallback, useEffect, useState } from "react";

// The order this person has chosen for their rail, kept on this computer. Empty
// until they move something, so the edition's own order shows until then.
const KEY = "murmur.rail.order.v1";

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Put `list` (already in the edition's order) into the person's order. Plugins
 *  they have placed come first, as placed; anything added since follows in the
 *  edition's order. */
export function arrange<T extends { id: string }>(list: T[], order: string[]): T[] {
  if (!order.length) return list;
  const at = (id: string) => order.indexOf(id);
  const placed = list.filter((m) => at(m.id) >= 0).sort((a, b) => at(a.id) - at(b.id));
  return [...placed, ...list.filter((m) => at(m.id) < 0)];
}

/** Move `id` to position `to` within `ids` (the rail as shown). */
export function moved(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const next = ids.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}

export function useRailOrder() {
  const [order, setOrder] = useState<string[]>(load);

  useEffect(() => {
    if (order.length) localStorage.setItem(KEY, JSON.stringify(order));
    else localStorage.removeItem(KEY);
  }, [order]);

  // Moving one plugin saves the whole rail as shown, so the order is exact.
  const move = useCallback((shown: string[], id: string, to: number) => {
    setOrder(moved(shown, id, to));
  }, []);

  const reset = useCallback(() => setOrder([]), []);

  return { order, move, reset, custom: order.length > 0 };
}
