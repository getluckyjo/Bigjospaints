import { describe, expect, it } from 'vitest';
import {
  brands,
  canMix,
  colours,
  defaultProductFor,
  getColour,
  getProduct,
  products,
  productsFor,
  sellingBrands,
  sizesFor,
  swatchTextColour,
} from '../../src/lib/catalogue';

describe('catalogue integrity', () => {
  it('has unique ids', () => {
    for (const list of [brands, products, colours]) {
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    }
  });

  it('gives every colour a valid swatch, family, base and a paint to mix it in', () => {
    const families = ['white', 'neutral', 'grey', 'green', 'blue', 'pink-terracotta', 'yellow-ochre', 'deep'];
    for (const c of colours) {
      expect(c.hex, c.id).toMatch(/^#[0-9A-F]{6}$/);
      expect(families, c.id).toContain(c.family);
      expect(['light', 'medium', 'deep'], c.id).toContain(c.base);
      expect(productsFor(c.brand).length, c.id).toBeGreaterThan(0);
      for (const p of productsFor(c.brand)) expect(sizesFor(p, c).length, `${c.id} in ${p.id}`).toBeGreaterThan(0);
    }
  });

  it('prices every tin in whole cents and keeps coverage realistic', () => {
    for (const p of products) {
      expect(p.coverageM2PerLitre, p.id).toBeGreaterThanOrEqual(4);
      expect(p.coverageM2PerLitre, p.id).toBeLessThanOrEqual(10);
      expect(p.coats, p.id).toBeGreaterThanOrEqual(1);
      const all = [...p.sizes, ...(p.bases?.medium ?? []), ...(p.bases?.deep ?? [])];
      for (const s of all) {
        expect(Number.isInteger(s.priceCents) && s.priceCents > 0, p.id).toBe(true);
        expect(s.litres, p.id).toBeGreaterThan(0);
      }
    }
  });

  it('only sells brands with colours and paints', () => {
    expect(sellingBrands.map((b) => b.id).sort()).toEqual(['dulux', 'duram', 'plascon', 'prominent']);
  });

  it('prices a deep colour from the deep base where there is one', () => {
    const deep = colours.find((c) => c.base === 'deep' && productsFor(c.brand).some((p) => p.bases?.deep))!;
    const product = productsFor(deep.brand).find((p) => p.bases?.deep)!;
    expect(sizesFor(product, deep)).toBe(product.bases!.deep);
    const light = colours.find((c) => c.base === 'light' && c.brand === deep.brand)!;
    expect(sizesFor(product, light)).toBe(product.sizes);
  });

  it('mixes a colour only in its own brand’s paints', () => {
    const plascon = colours.find((c) => c.brand === 'plascon')!;
    expect(canMix(plascon, defaultProductFor('plascon')!)).toBe(true);
    expect(canMix(plascon, defaultProductFor('dulux')!)).toBe(false);
  });

  it('looks things up by id only', () => {
    expect(getColour('nope')).toBeUndefined();
    expect(getProduct(42)).toBeUndefined();
  });

  it('chooses readable text on swatches', () => {
    expect(swatchTextColour('#FFFFFF')).toBe('ink');
    expect(swatchTextColour('#1F2A44')).toBe('bone');
  });
});
