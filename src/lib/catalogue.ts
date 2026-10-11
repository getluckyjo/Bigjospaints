/**
 * The paint catalogue: brands, products (with tin sizes and prices), sample pots and colours.
 * src/data/catalogue.json holds every price, the products, the sample pots and the hand-picked
 * colours (with notes). src/data/colours/<brand>.json holds each brand's full range as name, code
 * and hex; family, tint base and a short description come from the hex (colour-science.ts).
 * The AI may only pick colour and product ids that exist here, and every price shown or charged
 * comes from here.
 */
import data from '../data/catalogue.json';
import { baseFor, describe, familyFor, hexToLab, type Family, type Lab } from './colour-science';

export type ColourFamily = Family;

export interface Brand {
  id: string;
  name: string;
}

export type TinBase = 'light' | 'medium' | 'deep';
export interface TinPrice {
  litres: number;
  priceCents: number;
}

export interface Product {
  id: string;
  brand: string;
  name: string;
  finish: string;
  tier: 'premium' | 'mid';
  coverageM2PerLitre: number;
  coats: number;
  /** Light (pastel) tint base prices, used for light colours. */
  sizes: TinPrice[];
  /** Darker tint bases, where the brand sells them at different prices. */
  bases?: Partial<Record<'medium' | 'deep', TinPrice[]>>;
  bestFor: string;
}

export interface Colour {
  id: string;
  brand: string;
  name: string;
  code: string | null;
  hex: string;
  family: ColourFamily;
  lrv: number | null;
  /** The tint base it's mixed in: the brand's own where it says (Duram), else from its lightness. Decides the price. */
  base: TinBase;
  /** The brand's own tint base, where it publishes one. */
  tintBase?: SampleBase;
  notes: string;
  /** The brand's collection or range it's listed in, e.g. "Essential Collection". */
  collection: string | null;
  /** Hand-picked in catalogue.json, with its own notes. */
  featured: boolean;
  /** In the shortlist the AI consultant chooses from. */
  ai: boolean;
  /** Brand groupings beyond the collection, e.g. "colour-wall" for Dulux's in-store colour wall. */
  tags: string[];
}

/** Tint bases as the brands name them for sample pots: pastel (light), deep and clear or transparent (strongest). */
export type SampleBase = 'pastel' | 'deep' | 'clear';

export interface Sample {
  id: string;
  brand: string;
  name: string;
  finish: string;
  millilitres: number;
  /** Price by the tint base the colour needs; a missing base means this pot can't take those colours. */
  prices: Partial<Record<SampleBase, number>>;
  /** Only for colours in these collections (ready-mixed pots). */
  collections?: string[];
  /** Not for colours in these collections. */
  excludeCollections?: string[];
  /** Only for colours with one of these tags. */
  tags?: string[];
  /** What the brand says a pot covers, where it says. */
  covers?: string;
  sources: string[];
}

/** Something that goes in the cart: a paint or a sample pot. */
export interface Sellable {
  id: string;
  brand: string;
  name: string;
  finish: string;
}

export const FAMILIES: { id: ColourFamily; label: string }[] = [
  { id: 'white', label: 'Whites' },
  { id: 'neutral', label: 'Warm neutrals' },
  { id: 'grey', label: 'Greys' },
  { id: 'green', label: 'Greens' },
  { id: 'blue', label: 'Blues' },
  { id: 'purple', label: 'Purples and lilacs' },
  { id: 'pink-terracotta', label: 'Pinks, reds and terracottas' },
  { id: 'yellow-ochre', label: 'Yellows and ochres' },
  { id: 'deep', label: 'Deep and dramatic' },
];

export const TONES: { id: TinBase; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'medium', label: 'Mid-tone' },
  { id: 'deep', label: 'Deep' },
];

export const brands = data.brands as Brand[];
export const products = data.products as Product[];
export const samples = data.samples as Sample[];
export const catalogueChecked: string = data.checked;

// ---------- Colours: hand-picked ones, then each brand's full range ----------

interface RangeFile {
  brand: string;
  checked: string;
  source: string;
  sourceUrl: string;
  /** Collections whose colours join the AI's shortlist. */
  aiCollections: string[];
  /** Tags whose colours join the AI's shortlist. */
  aiTags?: string[];
  collections: string[];
  tintBases?: Record<string, string>;
  /** Tag name → row numbers, e.g. Dulux's in-store colour wall. */
  tags?: Record<string, number[]>;
  tagLabels?: Record<string, string>;
  /** [name, code, hex without #, collection index (-1 for none), tint base letter?] */
  rows: [string, string, string, number, string?][];
}

export const ranges = Object.values(
  import.meta.glob<RangeFile>('../data/colours/*.json', { eager: true, import: 'default' }),
).sort((a, b) => a.brand.localeCompare(b.brand));

const TINT_BASE: Record<string, SampleBase> = { p: 'pastel', d: 'deep', c: 'clear' };

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The brand's own tint base decides the paint base where it publishes one: pastel is light, the rest deep. */
const baseFromTint = (tint: SampleBase): TinBase => (tint === 'pastel' ? 'light' : 'deep');

function buildColours(): Colour[] {
  const norm = (text: string | null) => (text ?? '').trim().toUpperCase();
  const featured = (data.colours as Omit<Colour, 'collection' | 'featured' | 'ai' | 'tags'>[]).map(
    (raw): Colour => ({ ...raw, collection: null, featured: true, ai: true, tags: [] }),
  );
  const used = new Set(featured.map((c) => c.id));
  const out: Colour[] = [];
  for (const range of ranges) {
    const brandName = (data.brands as Brand[]).find((b) => b.id === range.brand)?.name ?? range.brand;
    // A hand-picked colour is the row with its code (and its name, where two names share a code).
    const byCode = new Map<string, number[]>();
    range.rows.forEach((row, i) => byCode.set(norm(row[1]), [...(byCode.get(norm(row[1])) ?? []), i]));
    const pickedRow = new Map<number, Colour>();
    for (const c of featured.filter((f) => f.brand === range.brand)) {
      const rows = byCode.get(norm(c.code)) ?? [];
      const i = rows.find((r) => norm(range.rows[r][0]) === norm(c.name)) ?? (rows.length === 1 ? rows[0] : undefined);
      if (i !== undefined) pickedRow.set(i, c);
    }
    const rowTags = new Map<number, string[]>();
    for (const [tag, rows] of Object.entries(range.tags ?? {})) for (const r of rows) rowTags.set(r, [...(rowTags.get(r) ?? []), tag]);

    range.rows.forEach(([name, code, hexDigits, collectionIndex, tint], i) => {
      const collection = range.collections[collectionIndex] ?? null;
      const tintBase = tint ? TINT_BASE[tint] : undefined;
      const tags = rowTags.get(i) ?? [];
      const ai =
        (collection !== null && range.aiCollections.includes(collection)) || tags.some((t) => range.aiTags?.includes(t));
      const pick = pickedRow.get(i);
      if (pick) {
        Object.assign(pick, { collection, tags });
        if (tintBase) Object.assign(pick, { tintBase, base: baseFromTint(tintBase) });
        return;
      }
      const hex = `#${hexDigits.toUpperCase()}`;
      let id = `${range.brand}-${slugify(name)}`;
      if (used.has(id)) id = `${id}-${slugify(code)}`;
      for (let n = 2; used.has(id); n++) id = `${range.brand}-${slugify(name)}-${n}`;
      used.add(id);
      const where = collection ? `${brandName} ${collection.replace(/^(Palette|Colour family): /, '')}` : brandName;
      out.push({
        id,
        brand: range.brand,
        name,
        code: code || null,
        hex,
        family: familyFor(hex),
        lrv: null,
        base: tintBase ? baseFromTint(tintBase) : baseFor(hex),
        ...(tintBase ? { tintBase } : {}),
        notes: `${describe(hex)} from the ${where} range`,
        collection,
        featured: false,
        ai,
        tags,
      });
    });
  }
  return [...featured, ...out];
}

export const colours: Colour[] = buildColours();
/** The shortlist the AI consultant and the brief-based picks choose from. */
export const aiColours = colours.filter((c) => c.ai);

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
const brandMap = byId(brands);
const productMap = byId(products);
const sampleMap = byId(samples);
const colourMap = byId(colours);

export const getBrand = (id: unknown) => (typeof id === 'string' ? brandMap.get(id) : undefined);
export const getProduct = (id: unknown) => (typeof id === 'string' ? productMap.get(id) : undefined);
export const getSample = (id: unknown) => (typeof id === 'string' ? sampleMap.get(id) : undefined);
export const getColour = (id: unknown) => (typeof id === 'string' ? colourMap.get(id) : undefined);

export const productsFor = (brandId: string) => products.filter((p) => p.brand === brandId);
export const coloursFor = (brandId: string) => colours.filter((c) => c.brand === brandId);

/** Brands with at least one colour and one priced product. */
export const sellingBrands = brands.filter((b) => productsFor(b.id).length > 0 && coloursFor(b.id).length > 0);

/** A brand's default wall paint: its premium matt-type product, else its first. */
export function defaultProductFor(brandId: string): Product | undefined {
  const list = productsFor(brandId);
  return list.find((p) => p.tier === 'premium') ?? list[0];
}

/** A colour can be mixed in any of its own brand's products. */
export function canMix(colour: Colour, product: Product): boolean {
  return colour.brand === product.brand;
}

/**
 * Tin sizes and prices for a colour in a product. Deep colours use the deep base where the brand
 * sells one; medium colours use the medium base, else the light base.
 */
export function sizesFor(product: Product, colour: Colour): TinPrice[] {
  if (colour.base === 'deep') return product.bases?.deep ?? product.bases?.medium ?? product.sizes;
  if (colour.base === 'medium') return product.bases?.medium ?? product.sizes;
  return product.sizes;
}

/** Lowest price per litre across sizes, for "from R… per litre". */
export function fromPricePerLitreCents(sizes: TinPrice[]): number {
  return Math.min(...sizes.map((s) => Math.round(s.priceCents / s.litres)));
}

/** Text colour (ink or bone) that reads on a swatch, by WCAG relative luminance. */
export function swatchTextColour(hex: string): 'ink' | 'bone' {
  const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against Ink (#292C27, L≈0.024) vs Bone (#F4F0E7, L≈0.87).
  const withInk = (lum + 0.05) / (0.0244 + 0.05);
  const withBone = (0.8714 + 0.05) / (lum + 0.05);
  return withInk >= withBone ? 'ink' : 'bone';
}

/** The tint base a colour needs in a sample pot. */
export function sampleBaseOf(colour: Colour): SampleBase {
  return colour.tintBase ?? (colour.base === 'light' ? 'pastel' : 'deep');
}

/** Sample pots that can be made in this colour, cheapest first. */
export function samplesFor(colour: Colour): { sample: Sample; priceCents: number }[] {
  const base = sampleBaseOf(colour);
  return samples
    .filter((s) => s.brand === colour.brand)
    .filter((s) => !s.collections || (colour.collection !== null && s.collections.includes(colour.collection)))
    .filter((s) => !(colour.collection !== null && s.excludeCollections?.includes(colour.collection)))
    .filter((s) => !s.tags || s.tags.some((t) => colour.tags.includes(t)))
    .flatMap((s) => (s.prices[base] ? [{ sample: s, priceCents: s.prices[base]! }] : []))
    .sort((a, b) => a.priceCents - b.priceCents);
}

/** The sample pot we offer for a colour (the cheapest that takes it), if the brand makes one. */
export function sampleFor(colour: Colour): { sample: Sample; priceCents: number } | undefined {
  return samplesFor(colour)[0];
}

/** Without a sample pot: the smallest tin of the brand's default paint, which is how the brand suggests testing. */
export function smallestTinFor(colour: Colour): { product: Product; litres: number; priceCents: number } | undefined {
  const product = defaultProductFor(colour.brand);
  if (!product) return undefined;
  const smallest = [...sizesFor(product, colour)].sort((a, b) => a.litres - b.litres)[0];
  return smallest ? { product, litres: smallest.litres, priceCents: smallest.priceCents } : undefined;
}

const labCache = new Map<string, Lab>();
export function labOf(colour: Colour): Lab {
  let lab = labCache.get(colour.hex);
  if (!lab) labCache.set(colour.hex, (lab = hexToLab(colour.hex)));
  return lab;
}

export function colourLabel(colour: Colour): string {
  return colour.code ? `${colour.name} (${colour.code})` : colour.name;
}
