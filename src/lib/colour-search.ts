/**
 * Searching and filtering the full colour range for /colours. Runs on the server from the query
 * string, so the filters work without JavaScript and every result page has its own address.
 */
import { FAMILIES, TONES, brands, colours, getBrand, labOf, type Colour, type ColourFamily, type TinBase } from './catalogue';
import { deltaE } from './colour-science';

export const PAGE_SIZE = 60;

export interface ColourQuery {
  q: string;
  brand: string | null;
  family: ColourFamily | null;
  tone: TinBase | null;
  page: number;
}

/** Read and clean the query string; anything unknown is ignored. */
export function parseColourQuery(params: URLSearchParams): ColourQuery {
  const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
    value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
  const page = Math.floor(Number(params.get('page') ?? 1));
  return {
    q: (params.get('q') ?? '').trim().slice(0, 60),
    brand: pick(params.get('brand'), brands.map((b) => b.id)),
    family: pick(params.get('family'), FAMILIES.map((f) => f.id)),
    tone: pick(params.get('tone'), TONES.map((t) => t.id)),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** Lower case, no accents, no punctuation: "Saphire B7-A1-1" → "saphire b7a11". */
const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '');
const compact = (text: string) => fold(text).replace(/ /g, '');

const familyLabel = new Map(FAMILIES.map((f) => [f.id, f.label]));
const haystack = new Map<string, { words: string; code: string }>();
function indexOf(colour: Colour) {
  let entry = haystack.get(colour.id);
  if (!entry) {
    const words = fold([colour.name, getBrand(colour.brand)?.name ?? '', familyLabel.get(colour.family) ?? '', colour.collection ?? ''].join(' '));
    entry = { words, code: compact(colour.code ?? '') };
    haystack.set(colour.id, entry);
  }
  return entry;
}

/** Every word must match the name, brand, family or collection, or the whole query the code. */
export function matches(colour: Colour, q: string): boolean {
  if (!q) return true;
  const { words, code } = indexOf(colour);
  const whole = compact(q);
  if (whole && code && code === whole) return true;
  return fold(q)
    .split(' ')
    .filter(Boolean)
    .every((w) => words.includes(w) || (code !== '' && code.startsWith(compact(w))));
}

const familyOrder = new Map(FAMILIES.map((f, i) => [f.id, i]));
/** Our hand-picked colours first, then by family, then light to dark within a family. */
const byFamilyThenLightness = (a: Colour, b: Colour) =>
  Number(b.featured) - Number(a.featured) ||
  (familyOrder.get(a.family) ?? 99) - (familyOrder.get(b.family) ?? 99) ||
  labOf(b)[0] - labOf(a)[0];

export function searchColours(query: ColourQuery) {
  const found = colours
    .filter((c) => (!query.brand || c.brand === query.brand) && (!query.family || c.family === query.family) && (!query.tone || c.base === query.tone))
    .filter((c) => matches(c, query.q))
    .sort(byFamilyThenLightness);
  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  return { total: found.length, page, pages, items: found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

/** The query string for a page of results, keeping the other filters. */
export function colourQueryString(query: ColourQuery, change: Partial<ColourQuery> = {}): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.brand) params.set('brand', next.brand);
  if (next.family) params.set('family', next.family);
  if (next.tone) params.set('tone', next.tone);
  if (next.page > 1) params.set('page', String(next.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The closest colours by eye (CIE76), from any brand: handy for comparing brands. */
export function closestColours(colour: Colour, count = 8): Colour[] {
  const lab = labOf(colour);
  const best: { c: Colour; d: number }[] = [];
  for (const c of colours) {
    if (c.id === colour.id) continue;
    const d = deltaE(lab, labOf(c));
    if (best.length === count && d >= best[count - 1].d) continue;
    const at = best.findIndex((b) => b.d > d);
    best.splice(at === -1 ? best.length : at, 0, { c, d });
    if (best.length > count) best.pop();
  }
  return best.map((b) => b.c);
}
