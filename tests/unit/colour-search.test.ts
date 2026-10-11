import { describe, expect, it } from 'vitest';
import { colours, getColour } from '../../src/lib/catalogue';
import { baseFor, deltaE, describe as describeHex, familyFor, hexToLab } from '../../src/lib/colour-science';
import { PAGE_SIZE, closestColours, colourQueryString, matches, parseColourQuery, searchColours } from '../../src/lib/colour-search';

const query = (text: string) => parseColourQuery(new URLSearchParams(text));

describe('colour maths', () => {
  it('converts hex to CIE L*a*b*', () => {
    expect(hexToLab('#FFFFFF')[0]).toBeCloseTo(100, 1);
    expect(hexToLab('#000000')[0]).toBeCloseTo(0, 5);
    expect(deltaE(hexToLab('#808080'), hexToLab('#808080'))).toBe(0);
  });

  it('sorts swatches into families and bases', () => {
    expect(familyFor('#FAF7F0')).toBe('white');
    expect(familyFor('#2B2B30')).toBe('deep');
    expect(familyFor('#8FA88A')).toBe('green');
    expect(familyFor('#5B7FA6')).toBe('blue');
    expect(familyFor('#B04A3A')).toBe('pink-terracotta');
    expect(familyFor('#D9A441')).toBe('yellow-ochre');
    expect(familyFor('#8E6FA8')).toBe('purple');
    expect(familyFor('#8C8C8C')).toBe('grey');
    expect(baseFor('#F0F0F0')).toBe('light');
    expect(baseFor('#777777')).toBe('medium');
    expect(baseFor('#333333')).toBe('deep');
    expect(describeHex('#CAD3C2')).toBe('soft sage green');
    expect(describeHex('#F4F1EA')).toBe('white');
    expect(describeHex('#F3E4CD')).toBe('warm white');
  });
});

describe('colour search', () => {
  it('ignores unknown filters and bad pages', () => {
    expect(query('brand=acme&family=tartan&tone=x&page=-3')).toEqual({ q: '', brand: null, family: null, tone: null, page: 1 });
    expect(query('brand=duram&family=green&tone=light&page=2&q=%20sage%20')).toEqual({ q: 'sage', brand: 'duram', family: 'green', tone: 'light', page: 2 });
  });

  it('finds colours by name, brand, family and code', () => {
    const egret = getColour('dulux-egret')!;
    expect(matches(egret, 'egret')).toBe(true);
    expect(matches(egret, 'dulux egret')).toBe(true);
    expect(matches(egret, 'plascon egret')).toBe(false);
    expect(matches(egret, egret.code!.toLowerCase())).toBe(true);
    expect(matches(getColour('plascon-sapphire')!, 'b7-a1-1')).toBe(true);
    expect(searchColours(query('q=desert%20spring')).items.map((c) => c.id)).toContain('plascon-desert-spring');
  });

  it('filters and pages through the results', () => {
    const all = searchColours(query(''));
    expect(all.total).toBe(colours.length);
    expect(all.items).toHaveLength(PAGE_SIZE);
    const greens = searchColours(query('brand=duram&family=green'));
    expect(greens.items.every((c) => c.brand === 'duram' && c.family === 'green')).toBe(true);
    const last = searchColours(query(`page=999`));
    expect(last.page).toBe(all.pages);
    expect(colourQueryString(query('brand=duram&page=3'), { page: 4 })).toBe('?brand=duram&page=4');
    expect(colourQueryString(query('page=3'), { page: 1 })).toBe('');
  });

  it('finds the closest colours from every brand', () => {
    const egret = getColour('dulux-egret')!;
    const near = closestColours(egret, 8);
    expect(near).toHaveLength(8);
    expect(near.some((c) => c.id === egret.id)).toBe(false);
    const d = near.map((c) => deltaE(hexToLab(egret.hex), hexToLab(c.hex)));
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });
});
