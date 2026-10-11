import { describe, expect, it } from 'vitest';
import { cheapestTins, describeMix, estimate, litresNeeded, wallAreaM2, type Room } from '../../src/lib/estimate';

const room: Room = { lengthM: 4, widthM: 4, heightM: 2.6, walls: 'all', doors: 1, windows: 1 };

describe('wall area', () => {
  it('is the perimeter times the height, less a door and a window', () => {
    // 2 × (4 + 4) × 2.6 = 41.6, less 1.9 and 1.5
    expect(wallAreaM2(room)).toBe(38.2);
  });
  it('is the longer wall for a feature wall', () => {
    expect(wallAreaM2({ ...room, lengthM: 5, walls: 'feature' })).toBe(13);
  });
  it('never takes away more than half the walls for openings', () => {
    expect(wallAreaM2({ ...room, lengthM: 1, widthM: 1, heightM: 2, doors: 6, windows: 10 })).toBe(4);
  });
});

describe('litres', () => {
  it('allows the coats and 10% extra, rounded up to 0.1 L', () => {
    expect(litresNeeded(38.2, 2, 10)).toBe(8.5); // 7.64 × 1.1 = 8.404 → 8.5
    expect(litresNeeded(10, 2, 8)).toBe(2.8); // 2.5 × 1.1 = 2.75 → 2.8
  });
});

describe('cheapest tin mix', () => {
  const sizes = [
    { litres: 1, priceCents: 25900 },
    { litres: 5, priceCents: 74900 },
    { litres: 20, priceCents: 229900 },
  ];
  it('covers the litres at the lowest cost', () => {
    const mix = cheapestTins(8.5, sizes);
    expect(mix.totalLitres).toBeGreaterThanOrEqual(8.5);
    expect(mix.totalCents).toBe(149800); // 2 × 5 L beats 1 × 5 L + 4 × 1 L (178500)
    expect(describeMix(mix)).toBe('2 × 5 L');
  });
  it('switches to a 20 L tin when it is cheaper', () => {
    expect(describeMix(cheapestTins(16, sizes))).toBe('1 × 20 L');
  });
  it('uses small tins for small jobs', () => {
    expect(describeMix(cheapestTins(1.8, sizes))).toBe('2 × 1 L');
  });
  it('prefers less leftover paint when prices tie', () => {
    const tie = [
      { litres: 2, priceCents: 1000 },
      { litres: 4, priceCents: 1000 },
    ];
    expect(cheapestTins(1.5, tie).totalLitres).toBe(2);
  });
  it('rejects an empty size list', () => {
    expect(() => cheapestTins(5, [])).toThrow();
  });
});

describe('estimate', () => {
  it('puts it together', () => {
    const e = estimate(room, { coverageM2PerLitre: 10, coats: 2, sizes: [{ litres: 5, priceCents: 89900 }] });
    expect(e).toMatchObject({ areaM2: 38.2, coats: 2, litres: 8.5 });
    expect(e.mix.totalCents).toBe(179800);
  });
});
