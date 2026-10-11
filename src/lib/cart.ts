/**
 * The cart lives in a cookie as ids and quantities only. Every price is looked up again from
 * the catalogue whenever the cart is shown or checked out, so a tampered cookie can't change one.
 */
import { canMix, getBrand, getColour, getProduct, sizesFor, type Colour, type Product } from './catalogue';
import type { OrderLine } from './orders';

export const CART_COOKIE = 'bjp_cart';
export const MAX_LINES = 20;
export const MAX_QTY = 50;

/** [productId, colourId, sizeLitres, quantity] */
export type CartEntry = [string, string, number, number];

export interface CartLine {
  key: string;
  product: Product;
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
    out.set(key, existing ? [line[0], line[1], line[2], Math.min(existing[3] + line[3], MAX_QTY)] : line);
  }
  return [...out.values()];
}

export function validEntry(entry: unknown): CartEntry | null {
  if (!Array.isArray(entry) || entry.length !== 4) return null;
  const [productId, colourId, size, qty] = entry;
  const product = getProduct(productId);
  const colour = getColour(colourId);
  const quantity = Number(qty);
  const litres = Number(size);
  if (!product || !colour || !canMix(colour, product)) return null;
  if (!sizesFor(product, colour).some((s) => s.litres === litres)) return null;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return null;
  return [product.id, colour.id, litres, quantity];
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
    if (existing) existing[3] = Math.min(existing[3] + a[3], MAX_QTY);
    else if (map.size < MAX_LINES) map.set(key, [...a] as CartEntry);
  }
  return [...map.values()];
}

export function setQuantity(entries: CartEntry[], key: string, quantity: number): CartEntry[] {
  return entries
    .map((e) => (lineKey(e[0], e[1], e[2]) === key ? ([e[0], e[1], e[2], quantity] as CartEntry) : e))
    .filter((e) => e[3] >= 1)
    .map((e) => [e[0], e[1], e[2], Math.min(e[3], MAX_QTY)] as CartEntry);
}

export function priceCart(entries: CartEntry[]): { lines: CartLine[]; subtotalCents: number; litres: number } {
  const lines: CartLine[] = [];
  for (const [productId, colourId, sizeLitres, quantity] of entries) {
    const product = getProduct(productId)!;
    const colour = getColour(colourId)!;
    const size = sizesFor(product, colour).find((s) => s.litres === sizeLitres)!;
    lines.push({
      key: lineKey(productId, colourId, sizeLitres),
      product,
      colour,
      brandName: getBrand(product.brand)?.name ?? product.brand,
      sizeLitres,
      quantity,
      unitPriceCents: size.priceCents,
      lineCents: size.priceCents * quantity,
    });
  }
  return {
    lines,
    subtotalCents: lines.reduce((sum, l) => sum + l.lineCents, 0),
    litres: lines.reduce((sum, l) => sum + l.sizeLitres * l.quantity, 0),
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
    sizeLitres: l.sizeLitres,
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
  }));
}

export function cartCount(entries: CartEntry[]): number {
  return entries.reduce((sum, e) => sum + e[3], 0);
}
