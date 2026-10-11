import { describe, expect, it } from 'vitest';
import {
  aiColours,
  brands,
  canMix,
  colours,
  coloursFor,
  getBrand,
  sampleFor,
  samples,
  slugify,
  smallestTinFor,
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
    const families = ['white', 'neutral', 'grey', 'green', 'blue', 'purple', 'pink-terracotta', 'yellow-ochre', 'deep'];
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

describe('full colour ranges', () => {
  it('loads each brand’s range and keeps the hand-picked colours and their ids', () => {
    for (const brand of ['plascon', 'dulux', 'duram', 'prominent']) expect(coloursFor(brand).length, brand).toBeGreaterThan(50);
    expect(colours.length).toBeGreaterThan(5000);
    for (const id of ['dulux-egret', 'plascon-desert-spring', 'prominent-river-clay', 'duram-tree-fern', 'plascon-ravine']) {
      expect(getColour(id)?.featured, id).toBe(true);
    }
    // A hand-picked colour isn't listed twice: its row in the brand's range is merged into it.
    expect(colours.filter((c) => c.brand === 'plascon' && c.code === '61')).toHaveLength(1);
    expect(getColour('plascon-ravine')!.collection).toBe('Essential Collection');
  });

  it('gives a different name the same slug a code suffix instead of a clash', () => {
    expect(getColour('plascon-thames-dusk')!.code).toBe('41');
    expect(getColour('plascon-thames-dusk-gr-b07')!.code).toBe('GR-B07');
    expect(slugify('Sophie’s Choice')).toBe('sophies-choice');
    expect(slugify('Rosé & Wine')).toBe('rose-and-wine');
  });

  it('keeps a hand-picked colour whose code another name shares', () => {
    // Dulux publishes 12GY 39/101 as both Soulful Sage and Sheer Stone.
    expect(getColour('dulux-soulful-sage')!.featured).toBe(true);
    expect(getColour('dulux-sheer-stone')!.code).toBe('12GY 39/101');
    expect(getColour('dulux-sheer-stone')!.tags).toContain('colour-wall');
  });

  it('uses Duram’s own tint base', () => {
    const deep = colours.find((c) => c.brand === 'duram' && c.tintBase === 'clear')!;
    expect(deep.base).toBe('deep');
    expect(colours.find((c) => c.brand === 'duram' && c.tintBase === 'pastel')!.base).toBe('light');
  });

  it('describes every colour, and shortlists the curated ones for the AI', () => {
    for (const c of colours) expect(c.notes.length, c.id).toBeGreaterThan(5);
    const curated = (c: (typeof colours)[number]) =>
      c.featured ||
      c.collection === 'Essential Collection' ||
      c.collection === 'Habitat Collection' ||
      c.brand === 'prominent' ||
      c.tags.some((t) => t.startsWith('colour-of-the-year'));
    expect(aiColours.every(curated)).toBe(true);
    expect(aiColours.length).toBeGreaterThan(300);
    for (const brand of ['plascon', 'dulux', 'duram', 'prominent']) expect(aiColours.some((c) => c.brand === brand), brand).toBe(true);
  });
});

describe('sample pots', () => {
  const plascon = (base: string) => colours.find((c) => c.brand === 'plascon' && c.base === base)!;

  it('offers the cheapest pot that takes the colour', () => {
    expect(sampleFor(plascon('light'))).toMatchObject({ sample: { id: 'plascon-perfect-colour-matt-tester' }, priceCents: 4500 });
    expect(sampleFor(plascon('deep'))).toMatchObject({ sample: { id: 'plascon-double-velvet-tester' }, priceCents: 6500 });
    expect(sampleFor(getColour('duram-tree-fern')!)).toMatchObject({ sample: { id: 'duram-habitat-sample' }, priceCents: 3600 });
    const clear = colours.find((c) => c.brand === 'duram' && c.tintBase === 'clear' && c.collection?.startsWith('Colour family'))!;
    expect(sampleFor(clear)).toMatchObject({ sample: { id: 'duram-walltech-tester' }, priceCents: 8900 });
  });

  it('offers the Dulux tester only for colour-wall colours', () => {
    const wall = colours.find((c) => c.brand === 'dulux' && c.tags.includes('colour-wall'))!;
    expect(sampleFor(wall)).toMatchObject({ sample: { id: 'dulux-luxurious-colour-tester' }, priceCents: 9900 });
    const other = colours.find((c) => c.brand === 'dulux' && !c.tags.includes('colour-wall'))!;
    expect(sampleFor(other)).toBeUndefined();
    expect(smallestTinFor(other)?.litres).toBe(1);
  });

  it('has none where the brand makes none, and offers the smallest tin instead', () => {
    const offWhite = colours.find((c) => c.collection === 'Off-White Collection')!;
    expect(sampleFor(offWhite)).toBeUndefined();
    const prominent = getColour('prominent-river-clay')!;
    expect(sampleFor(prominent)).toBeUndefined();
    expect(smallestTinFor(prominent)).toMatchObject({ product: { id: 'prominent-premium-matt' }, litres: 1, priceCents: 17995 });
  });

  it('only prices pots in whole cents for real tint bases', () => {
    for (const s of samples) {
      expect(getBrand(s.brand), s.id).toBeDefined();
      expect(Object.keys(s.prices).every((k) => ['pastel', 'deep', 'clear'].includes(k)), s.id).toBe(true);
      for (const cents of Object.values(s.prices)) expect(Number.isInteger(cents) && cents! > 0, s.id).toBe(true);
      expect(s.sources.length, s.id).toBeGreaterThan(0);
    }
  });
});
