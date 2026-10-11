/**
 * The paint catalogue: brands, products (with tin sizes and prices) and colours.
 * src/data/catalogue.json is the only source of colours and prices. The AI may only pick
 * colour and product ids that exist here, and every price shown or charged comes from here.
 */
import data from '../data/catalogue.json';

export type ColourFamily = 'white' | 'neutral' | 'grey' | 'green' | 'blue' | 'pink-terracotta' | 'yellow-ochre' | 'deep';

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
  /** The tint base it's mixed in, estimated from its lightness; decides the price. */
  base: TinBase;
  notes: string;
}

export const FAMILIES: { id: ColourFamily; label: string }[] = [
  { id: 'white', label: 'Whites' },
  { id: 'neutral', label: 'Warm neutrals' },
  { id: 'grey', label: 'Greys' },
  { id: 'green', label: 'Greens' },
  { id: 'blue', label: 'Blues' },
  { id: 'pink-terracotta', label: 'Pinks and terracottas' },
  { id: 'yellow-ochre', label: 'Yellows and ochres' },
  { id: 'deep', label: 'Deep and dramatic' },
];

export const brands = data.brands as Brand[];
export const products = data.products as Product[];
export const colours = data.colours as Colour[];
export const catalogueChecked: string = data.checked;

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
const brandMap = byId(brands);
const productMap = byId(products);
const colourMap = byId(colours);

export const getBrand = (id: unknown) => (typeof id === 'string' ? brandMap.get(id) : undefined);
export const getProduct = (id: unknown) => (typeof id === 'string' ? productMap.get(id) : undefined);
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

export function colourLabel(colour: Colour): string {
  return colour.code ? `${colour.name} (${colour.code})` : colour.name;
}
