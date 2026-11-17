// Helpers for the store-room screens: the walking order of the shelves, and where a new part probably belongs.
export type RouteLayout = { areas: { id: string; name: string }[]; racks: { id: string; name: string; area_id?: string | null; levels: { id: string; name: string }[] }[] };

/** shelf label (lower case) -> its place in a walk round the store room: wall by wall, rack by rack, level by level. */
export function shelfRoute(layout: RouteLayout | null | undefined): Map<string, number> {
  const order = new Map<string, number>();
  if (!layout) return order;
  const walls = [...layout.areas.map((a) => a.id), ""]; // racks with no wall come last
  let n = 0;
  for (const w of walls) for (const r of layout.racks.filter((x) => (x.area_id || "") === w)) {
    if (!r.levels.length) order.set(r.name.toLowerCase(), n++);
    for (const l of r.levels) order.set((r.name + "-" + l.name).toLowerCase(), n++);
  }
  return order;
}
export const routeIndex = (order: Map<string, number>, location?: string | null) => (location && order.has(location.toLowerCase()) ? order.get(location.toLowerCase())! : 1e9);

/** The shelf most parts of this category already sit on (the first wins a tie). Empty when nothing of that category has a shelf. */
export function suggestShelf(items: { category?: string; location?: string; archived?: boolean }[], category?: string): string {
  const want = (category || "").trim().toLowerCase();
  if (!want) return "";
  const seen = new Map<string, number>();
  for (const p of items) if (!p.archived && p.location && (p.category || "").trim().toLowerCase() === want) seen.set(p.location, (seen.get(p.location) || 0) + 1);
  let best = "", top = 0;
  for (const [loc, n] of seen) if (n > top) { best = loc; top = n; }
  return best;
}
