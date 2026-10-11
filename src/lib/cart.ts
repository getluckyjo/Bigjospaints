/**
 * The cart lives in a cookie as ids and quantities only. Every price is looked up again from
 * the catalogue whenever the cart is shown or checked out, so a tampered cookie can't change one.
 */
import { canMix, getBrand, getColour, getProduct, getSample, samplesFor, sizesFor, type Colour, type Sellable } from './catalogue';
import type { OrderLine } from './orders';

export const CART_COOKIE = 'bjp_cart';
export const MAX_LINES = 20;
export const MAX_QTY = 50;
/** Sample pots per colour: enough for a few walls, not a paint job. */
export const MAX_SAMPLES = 5;

/** [productId or sampleId, colourId, sizeLitres, quantity]. A sample pot's size is its millilitres / 1000. */
export type CartEntry = [string, string, number, number];

export interface CartLine {
  key: string;
  product: Sellable;
  /** A sample pot rather than a tin of paint. */
  isSample: boolean;
  colour: Colour;
  brandName: string;
  sizeLitres: number;
  quantity: number;
  unitPriceCents: number;
  lineCents: number;
}

export const lineKey = (productId: string, colourId: string, sizeLitres: number) => `${productId}|${colourId}|${sizeLitres}`;

/** Parse the cookie value. Anything malformed or no longer in the catalogue is dropped. */
export function parseCart(value: string | undefined | null): CartEntry[] {
  if (!value) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, CartEntry>();
  for (const entry of raw.slice(0, MAX_LINES)) {
    const line = validEntry(entry);
    if (!line) continue;
    const key = lineKey(line[0], line[1], line[2]);
    const existing = out.get(key);
    out.set(key, existing ? [line[0], line[1], line[2], Math.min(existing[3] + line[3], maxQty(line[0]))] : line);
  }
  return [...out.values()];
}

export function validEntry(entry: unknown): CartEntry | null {
  if (!Array.isArray(entry) || entry.length !== 4) return null;
  const [productId, colourId, size, qty] = entry;
  const colour = getColour(colourId);
  const quantity = Number(qty);
  const litres = Number(size);
  if (!colour || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return null;
  const sample = getSample(productId);
  if (sample) {
    // Only a pot that can be made in this colour, at its own size.
    if (!samplesFor(colour).some((s) => s.sample.id === sample.id) || litres !== sample.millilitres / 1000) return null;
    return [sample.id, colour.id, litres, Math.min(quantity, MAX_SAMPLES)];
  }
  const product = getProduct(productId);
  if (!product || !canMix(colour, product)) return null;
  if (!sizesFor(product, colour).some((s) => s.litres === litres)) return null;
  return [product.id, colour.id, litres, quantity];
}

/** A sample pot of a colour, as a cart entry; null if the brand doesn't make one for it. */
export function sampleEntry(colourId: unknown, sampleId: unknown, qty = 1): CartEntry | null {
  const sample = getSample(sampleId);
  return sample ? validEntry([sample.id, colourId, sample.millilitres / 1000, qty]) : null;
}

export function serializeCart(entries: CartEntry[]): string {
  return Buffer.from(JSON.stringify(entries.slice(0, MAX_LINES)), 'utf8').toString('base64url');
}

/** Add entries, merging quantities for the same product, colour and size. */
export function addToCart(entries: CartEntry[], additions: CartEntry[]): CartEntry[] {
  const map = new Map(entries.map((e) => [lineKey(e[0], e[1], e[2]), [...e] as CartEntry]));
  for (const a of additions) {
    const key = lineKey(a[0], a[1], a[2]);
    const existing = map.get(key);
    if (existing) existing[3] = Math.min(existing[3] + a[3], maxQty(a[0]));
    else if (map.size < MAX_LINES) map.set(key, [...a] as CartEntry);
  }
  return [...map.values()];
}

export function setQuantity(entries: CartEntry[], key: string, quantity: number): CartEntry[] {
  return entries
    .map((e) => (lineKey(e[0], e[1], e[2]) === key ? ([e[0], e[1], e[2], quantity] as CartEntry) : e))
    .filter((e) => e[3] >= 1)
    .map((e) => [e[0], e[1], e[2], Math.min(e[3], maxQty(e[0]))] as CartEntry);
}

export const maxQty = (productId: string) => (getSample(productId) ? MAX_SAMPLES : MAX_QTY);

export function priceCart(entries: CartEntry[]): { lines: CartLine[]; subtotalCents: number; litres: number; pots: number } {
  const lines: CartLine[] = [];
  for (const [productId, colourId, sizeLitres, quantity] of entries) {
    const colour = getColour(colourId)!;
    const sample = samplesFor(colour).find((s) => s.sample.id === productId);
    const product: Sellable = sample?.sample ?? getProduct(productId)!;
    const unitPriceCents = sample ? sample.priceCents : sizesFor(getProduct(productId)!, colour).find((s) => s.litres === sizeLitres)!.priceCents;
    lines.push({
      key: lineKey(productId, colourId, sizeLitres),
      product,
      isSample: Boolean(sample),
      colour,
      brandName: getBrand(product.brand)?.name ?? product.brand,
      sizeLitres,
      quantity,
      unitPriceCents,
      lineCents: unitPriceCents * quantity,
    });
  }
  return {
    lines,
    subtotalCents: lines.reduce((sum, l) => sum + l.lineCents, 0),
    litres: lines.filter((l) => !l.isSample).reduce((sum, l) => sum + l.sizeLitres * l.quantity, 0),
    pots: lines.filter((l) => l.isSample).reduce((sum, l) => sum + l.quantity, 0),
  };
}

export function toOrderLines(lines: CartLine[]): OrderLine[] {
  return lines.map((l) => ({
    productId: l.product.id,
    productName: l.product.name,
    brandName: l.brandName,
    colourId: l.colour.id,
    colourName: l.colour.name,
    colourCode: l.colour.code,
    ...(l.isSample ? { isSample: true } : {}),
    sizeLitres: l.sizeLitres,
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
  }));
}

/** "Paint", "Sample pots" or "Paint and samples", for a subtotal row. */
export function itemsHeading(lines: { isSample?: boolean }[]): string {
  const samples = lines.filter((l) => l.isSample).length;
  return samples === 0 ? 'Paint' : samples === lines.length ? 'Sample pots' : 'Paint and samples';
}

export function cartCount(entries: CartEntry[]): number {
  return entries.reduce((sum, e) => sum + e[3], 0);
}
