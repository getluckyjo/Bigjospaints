/**
 * How much paint a room needs, and the cheapest mix of tins that covers it.
 * All maths happens here, on the server, from catalogue data: the AI never sets a quantity or a price.
 */

export interface Room {
  lengthM: number;
  widthM: number;
  heightM: number;
  /** All four walls, or one feature wall (the longer wall). */
  walls: 'all' | 'feature';
  doors: number;
  windows: number;
}

/** A standard interior door (0.9 × 2.1 m) and a typical window (about 1.2 × 1.25 m). */
export const DOOR_M2 = 1.9;
export const WINDOW_M2 = 1.5;
/** Extra paint for cutting in, absorbent walls and touch-ups. */
export const EXTRA = 0.1;

export const ROOM_PRESETS = {
  small: { label: 'Small room', hint: 'About 3 × 3 m, like a study or small bedroom', lengthM: 3, widthM: 3 },
  medium: { label: 'Medium room', hint: 'About 4 × 4 m, like a main bedroom', lengthM: 4, widthM: 4 },
  large: { label: 'Large room', hint: 'About 6 × 4 m, like a lounge', lengthM: 6, widthM: 4 },
} as const;
export type RoomPreset = keyof typeof ROOM_PRESETS;
export const DEFAULT_HEIGHT_M = 2.6;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function wallAreaM2(room: Room): number {
  if (room.walls === 'feature') return round1(Math.max(room.lengthM, room.widthM) * room.heightM);
  const gross = 2 * (room.lengthM + room.widthM) * room.heightM;
  const openings = room.doors * DOOR_M2 + room.windows * WINDOW_M2;
  return round1(Math.max(gross - openings, gross * 0.5));
}

/** Litres for the given area and coats, plus 10% extra, rounded up to the next 0.1 L. */
export function litresNeeded(areaM2: number, coats: number, coverageM2PerLitre: number): number {
  return Math.ceil(((areaM2 * coats) / coverageM2PerLitre) * (1 + EXTRA) * 10) / 10;
}

export interface TinSize {
  litres: number;
  priceCents: number;
}

export interface TinMix {
  tins: { litres: number; quantity: number; priceCents: number }[];
  totalLitres: number;
  totalCents: number;
}

/**
 * Cheapest combination of tins holding at least `litres`. Ties go to less leftover paint,
 * then fewer tins. Exhaustive over a small search space (a few sizes, at most ~100 L).
 */
export function cheapestTins(litres: number, sizes: TinSize[]): TinMix {
  const usable = sizes.filter((s) => s.litres > 0 && s.priceCents > 0).sort((a, b) => b.litres - a.litres);
  if (usable.length === 0) throw new Error('No tin sizes to choose from');
  const need = Math.max(litres, 0.1);
  let best: { counts: number[]; cents: number; litres: number; tins: number } | null = null;
  const counts = new Array(usable.length).fill(0);

  const better = (cents: number, total: number, tins: number) =>
    !best ||
    cents < best.cents ||
    (cents === best.cents && (total < best.litres || (total === best.litres && tins < best.tins)));

  const search = (i: number, litresSoFar: number, centsSoFar: number, tinsSoFar: number) => {
    if (best && centsSoFar > best.cents) return;
    if (litresSoFar >= need - 1e-9) {
      if (better(centsSoFar, litresSoFar, tinsSoFar)) {
        best = { counts: [...counts], cents: centsSoFar, litres: litresSoFar, tins: tinsSoFar };
      }
      return;
    }
    if (i === usable.length) return;
    const size = usable[i];
    const max = Math.ceil((need - litresSoFar) / size.litres);
    for (let n = max; n >= 0; n--) {
      counts[i] = n;
      search(i + 1, litresSoFar + n * size.litres, centsSoFar + n * size.priceCents, tinsSoFar + n);
    }
    counts[i] = 0;
  };
  search(0, 0, 0, 0);

  const chosen = best!;
  return {
    tins: usable
      .map((s, i) => ({ litres: s.litres, quantity: chosen.counts[i], priceCents: s.priceCents }))
      .filter((t) => t.quantity > 0),
    totalLitres: round1(chosen.litres),
    totalCents: chosen.cents,
  };
}

export interface Estimate {
  areaM2: number;
  coats: number;
  litres: number;
  mix: TinMix;
}

export function estimate(room: Room, product: { coverageM2PerLitre: number; coats: number; sizes: TinSize[] }): Estimate {
  const areaM2 = wallAreaM2(room);
  const litres = litresNeeded(areaM2, product.coats, product.coverageM2PerLitre);
  return { areaM2, coats: product.coats, litres, mix: cheapestTins(litres, product.sizes) };
}

/** "2 × 5 L + 1 × 1 L" */
export function describeMix(mix: TinMix): string {
  return mix.tins.map((t) => `${t.quantity} × ${formatLitres(t.litres)}`).join(' + ');
}

export function formatLitres(litres: number): string {
  if (litres > 0 && litres < 1) return `${Math.round(litres * 1000)} ml`;
  return `${Number.isInteger(litres) ? litres : litres.toFixed(1)} L`;
}
