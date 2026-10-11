import { describe, expect, it } from 'vitest';
import { addToCart, lineKey, parseCart, priceCart, serializeCart, setQuantity, type CartEntry } from '../../src/lib/cart';
import { applyCartAction } from '../../src/lib/cart-actions';
import { colours, productsFor, sizesFor } from '../../src/lib/catalogue';

const colour = colours.find((c) => c.brand === 'plascon' && c.base === 'light')!;
const product = productsFor('plascon')[0];
const size = sizesFor(product, colour)[0];
const entry: CartEntry = [product.id, colour.id, size.litres, 2];

describe('cart cookie', () => {
  it('round-trips', () => {
    expect(parseCart(serializeCart([entry]))).toEqual([entry]);
  });

  it('drops anything tampered with or no longer sold', () => {
    const otherBrand = productsFor('dulux')[0];
    const bad = Buffer.from(
      JSON.stringify([
        ['ghost-paint', colour.id, size.litres, 1],
        [otherBrand.id, colour.id, otherBrand.sizes[0].litres, 1],
        [product.id, colour.id, 3.3, 1],
        [product.id, colour.id, size.litres, 0],
        [product.id, colour.id, size.litres, 51],
        [product.id, colour.id, size.litres, 1.5],
        entry,
      ]),
    ).toString('base64url');
    expect(parseCart(bad)).toEqual([entry]);
    expect(parseCart('not base64 json')).toEqual([]);
    expect(parseCart(undefined)).toEqual([]);
  });

  it('merges the same paint, colour and size', () => {
    expect(addToCart([entry], [[product.id, colour.id, size.litres, 3]])).toEqual([[product.id, colour.id, size.litres, 5]]);
  });

  it('changes and removes quantities', () => {
    const key = lineKey(product.id, colour.id, size.litres);
    expect(setQuantity([entry], key, 4)[0][3]).toBe(4);
    expect(setQuantity([entry], key, 0)).toEqual([]);
  });

  it('prices from the catalogue, never from the cookie', () => {
    const { lines, subtotalCents } = priceCart([entry]);
    expect(lines[0].unitPriceCents).toBe(size.priceCents);
    expect(subtotalCents).toBe(size.priceCents * 2);
  });
});

describe('cart actions', () => {
  it('adds a consultant tin mix as several lines', () => {
    const form = new FormData();
    form.set('action', 'add');
    form.append('line', `${product.id}|${colour.id}|${size.litres}|2`);
    form.append('line', `bogus|${colour.id}|1|1`);
    const { entries, added } = applyCartAction([], form);
    expect(entries).toEqual([entry]);
    expect(added).toBe(2);
  });

  it('adds one line from a colour page', () => {
    const form = new FormData();
    form.set('action', 'add-one');
    form.set('colour', colour.id);
    form.set('size', `${product.id}|${size.litres}`);
    form.set('qty', '2');
    expect(applyCartAction([], form).entries).toEqual([entry]);
  });

  it('removes a line', () => {
    const form = new FormData();
    form.set('action', 'remove');
    form.set('key', lineKey(product.id, colour.id, size.litres));
    expect(applyCartAction([entry], form).entries).toEqual([]);
  });
});
