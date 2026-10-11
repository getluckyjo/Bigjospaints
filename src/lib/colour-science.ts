/**
 * Colour maths for the catalogue: CIE L*a*b* from a screen hex, a colour family and a tint base
 * from those numbers, and a plain description. Used for the brands' full ranges, which come with a
 * name, code and hex only; the hand-picked colours in catalogue.json keep their own family and notes.
 */

export type Lab = [number, number, number];

/** sRGB hex (#RRGGBB) to CIE L*a*b* (D65). */
export function hexToLab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lightness, chroma and hue angle (degrees). */
export function lch([l, a, b]: Lab): { l: number; c: number; h: number } {
  return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

/** CIE76 colour difference: under about 2.3 most people can't tell two colours apart. */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export type Family = 'white' | 'neutral' | 'grey' | 'green' | 'blue' | 'purple' | 'pink-terracotta' | 'yellow-ochre' | 'deep';
export type Base = 'light' | 'medium' | 'deep';

/**
 * A colour family from lightness, chroma and hue. Tuned on the hand-sorted colours in
 * catalogue.json (it agrees with 60 of the 70); borderline colours can land in either family.
 */
export function familyFor(hex: string): Family {
  const { l, c, h } = lch(hexToLab(hex));
  if (l < 36) return 'deep';
  if (l >= 89 && c < 14) return 'white';
  if (c < 5) return 'grey';
  if (h < 35 || h >= 345) return c >= 8 ? 'pink-terracotta' : 'neutral';
  if (h < 105) {
    if (c < 16) return 'neutral';
    return h < 65 ? 'pink-terracotta' : 'yellow-ochre';
  }
  if (h < 200) return 'green';
  if (h < 300) return 'blue';
  return 'purple';
}

/** The tint base a colour is likely mixed in, from its lightness (L* 65+ light, 45–65 medium, under 45 deep). */
export function baseFor(hex: string): Base {
  const l = hexToLab(hex)[0];
  return l >= 65 ? 'light' : l >= 45 ? 'medium' : 'deep';
}

/** "pale green", "deep terracotta": what the swatch looks like, for colours without hand-written notes. */
export function describe(hex: string): string {
  const { l, c, h } = lch(hexToLab(hex));
  const tone = l >= 85 ? 'pale' : l >= 70 ? 'soft' : l >= 50 ? 'mid-tone' : 'deep';
  let noun: string;
  if (l >= 89 && c < 14) return c < 4 ? 'white' : h >= 60 && h < 105 ? 'warm white' : 'off-white';
  if (c < 5) noun = 'grey';
  else if (h < 35 || h >= 345) noun = c < 8 ? 'greige' : l >= 65 ? 'pink' : 'red';
  else if (h < 65) noun = c < 16 ? 'warm neutral' : l >= 75 ? 'peach' : 'terracotta';
  else if (h < 105) noun = c < 16 ? (l >= 60 ? 'beige' : 'taupe') : l >= 70 ? 'yellow' : 'ochre';
  else if (h < 200) noun = c < 12 ? 'sage green' : 'green';
  else if (h < 300) noun = c < 12 ? 'grey-blue' : 'blue';
  else noun = l >= 70 ? 'lilac' : 'purple';
  return `${tone} ${noun}`;
}
