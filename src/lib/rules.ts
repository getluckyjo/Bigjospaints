/**
 * Brief-based picks, used when the AI isn't connected (no OPENAI_API_KEY) or doesn't answer.
 * Simple keyword rules over the catalogue; the page always says when these are shown.
 */
import { colours, defaultProductFor, productsFor, type Colour, type ColourFamily, type Product } from './catalogue';
import type { Suggestion } from './ai';

const RULES: { words: RegExp; families: ColourFamily[] }[] = [
  { words: /\b(calm|serene|relax\w*|peace\w*|sleep|tranquil|restful|spa)\b/i, families: ['green', 'blue', 'neutral'] },
  { words: /\b(warm|cos[yi]|snug|inviting|hygge)\b/i, families: ['neutral', 'pink-terracotta', 'yellow-ochre'] },
  { words: /\b(bright|airy|light|fresh|clean|open|small|tiny|dark room)\b/i, families: ['white', 'neutral', 'blue'] },
  { words: /\b(bold|dramatic|statement|moody|dark|deep|rich|feature)\b/i, families: ['deep', 'green', 'blue'] },
  { words: /\b(earthy|natural|organic|rustic|boho|plants?)\b/i, families: ['neutral', 'green', 'pink-terracotta'] },
  { words: /\b(modern|minimal\w*|scandi\w*|sleek|contemporary)\b/i, families: ['white', 'grey', 'neutral'] },
  { words: /\b(kids?|child\w*|play\w*|fun|cheerful|happy|nursery)\b/i, families: ['yellow-ochre', 'blue', 'green'] },
  { words: /\b(gr[ae]ys?)\b/i, families: ['grey'] },
  { words: /\b(greens?|sage|olive|forest)\b/i, families: ['green'] },
  { words: /\b(blues?|navy|ocean|sea)\b/i, families: ['blue'] },
  { words: /\b(pinks?|terracotta|blush|rust|clay)\b/i, families: ['pink-terracotta'] },
  { words: /\b(yellows?|ochre|mustard|sunny|gold\w*)\b/i, families: ['yellow-ochre'] },
  { words: /\b(whites?|cream)\b/i, families: ['white'] },
  { words: /\b(beige|neutral|greige|taupe|sand)\b/i, families: ['neutral'] },
];

const DEFAULT_FAMILIES: ColourFamily[] = ['neutral', 'green', 'white', 'grey', 'blue'];

const TITLES: Record<ColourFamily, string> = {
  white: 'Bright and simple',
  neutral: 'Warm and easy',
  grey: 'Calm and modern',
  green: 'Fresh and grounded',
  blue: 'Cool and restful',
  'pink-terracotta': 'Earthy and warm',
  'yellow-ochre': 'Sunny and welcoming',
  deep: 'Bold and cosy',
};

const WASHABLE_ROOMS = /\b(kitchen|bathroom|kids?|child\w*|nursery|passage|hallway|entrance|playroom|laundry)\b/i;

/** Families the brief points to, strongest first, padded with sensible defaults. */
export function familiesFor(text: string): ColourFamily[] {
  const scores = new Map<ColourFamily, number>();
  for (const rule of RULES) {
    if (!rule.words.test(text)) continue;
    rule.families.forEach((f, i) => scores.set(f, (scores.get(f) ?? 0) + (3 - i)));
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  for (const f of DEFAULT_FAMILIES) if (!ranked.includes(f)) ranked.push(f);
  return ranked;
}

/** Stable small hash so the same brief gives the same picks. */
function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function productFor(colour: Colour, washable: boolean): Product | undefined {
  if (washable) {
    const sheen = productsFor(colour.brand).find((p) => /sheen|silk|satin|eggshell/i.test(p.finish));
    if (sheen) return sheen;
  }
  return defaultProductFor(colour.brand);
}

export function rulePicks(brief: string, roomType: string, exclude: string[] = []): Suggestion[] {
  const text = `${brief} ${roomType}`;
  const families = familiesFor(text);
  const washable = WASHABLE_ROOMS.test(text);
  const seed = hash(text.toLowerCase());
  const picks: Suggestion[] = [];
  const usedBrands = new Set<string>();

  for (const family of families) {
    if (picks.length === 3) break;
    const pool = colours.filter((c) => c.family === family && !exclude.includes(c.id) && !picks.some((p) => p.colour.id === c.id));
    if (pool.length === 0) continue;
    // Prefer a brand not used yet, then rotate through the pool by the brief's hash.
    const fresh = pool.filter((c) => !usedBrands.has(c.brand));
    const from = fresh.length ? fresh : pool;
    const colour = from[(seed + picks.length * 7) % from.length];
    const product = productFor(colour, washable);
    if (!product) continue;
    usedBrands.add(colour.brand);
    picks.push({
      colour,
      product,
      title: TITLES[family],
      why: `${colour.name}: ${colour.notes}.`,
      tip: washable ? 'A washable finish makes marks easy to wipe off.' : 'Paint a test patch on two walls and look at it morning and evening before you decide.',
    });
  }
  return picks;
}
