import { describe, expect, it } from 'vitest';
import {
  MAX_SAMPLES,
  addToCart,
  itemsHeading,
  lineKey,
  parseCart,
  priceCart,
  sampleEntry,
  serializeCart,
  setQuantity,
  toOrderLines,
  validEntry,
  type CartEntry,
} from '../../src/lib/cart';
import { applyCartAction } from '../../src/lib/cart-actions';
import { colours, getColour, productsFor, sizesFor } from '../../src/lib/catalogue';
import { formatLitres } from '../../src/lib/estimate';

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

describe('sample pots in the cart', () => {
  const light = colours.find((c) => c.brand === 'plascon' && c.base === 'light')!;
  const prominent = getColour('prominent-river-clay')!;
  const pot: CartEntry = ['plascon-perfect-colour-matt-tester', light.id, 0.25, 1];

  it('adds a sample pot from a colour page and prices it from the catalogue', () => {
    const form = new FormData();
    form.set('action', 'add-sample');
    form.set('colour', light.id);
    form.set('sample', 'plascon-perfect-colour-matt-tester');
    const { entries, added } = applyCartAction([entry], form);
    expect(entries).toEqual([entry, pot]);
    expect(added).toBe(1);
    const priced = priceCart(entries);
    const line = priced.lines[1];
    expect(line).toMatchObject({ isSample: true, unitPriceCents: 4500, sizeLitres: 0.25 });
    expect(line.product.name).toBe('Perfect Colour Matt tester');
    expect(priced.pots).toBe(1);
    expect(priced.litres).toBe(size.litres * 2);
    expect(itemsHeading(priced.lines)).toBe('Paint and samples');
    expect(toOrderLines([line])[0]).toMatchObject({ isSample: true, productName: 'Perfect Colour Matt tester', sizeLitres: 0.25, unitPriceCents: 4500 });
    expect(formatLitres(0.25)).toBe('250 ml');
  });

  it('refuses a pot the brand can’t make in that colour, or at the wrong size', () => {
    const deep = colours.find((c) => c.brand === 'plascon' && c.base === 'deep')!;
    expect(validEntry(['plascon-perfect-colour-matt-tester', deep.id, 0.25, 1])).toBeNull(); // pastel base only
    expect(validEntry(['plascon-perfect-colour-matt-tester', prominent.id, 0.25, 1])).toBeNull(); // another brand
    expect(validEntry(['plascon-perfect-colour-matt-tester', light.id, 1, 1])).toBeNull();
    expect(sampleEntry(prominent.id, 'duram-habitat-sample')).toBeNull();
  });

  it('caps sample pots at a few per colour', () => {
    expect(validEntry([...pot.slice(0, 3), 9] as CartEntry)![3]).toBe(MAX_SAMPLES);
    expect(addToCart([pot], [[...pot.slice(0, 3), 9] as CartEntry])[0][3]).toBe(MAX_SAMPLES);
    expect(setQuantity([pot], lineKey(pot[0], pot[1], pot[2]), 20)[0][3]).toBe(MAX_SAMPLES);
  });
});
