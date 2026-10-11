import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowConsult, consult, consultSchema, photoDataUrl } from '../../src/lib/consult';
import { familiesFor, rulePicks } from '../../src/lib/rules';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('consult form', () => {
  it('uses the preset sizes', () => {
    const parsed = consultSchema.parse({ brief: 'calm', roomType: 'Lounge', size: 'large', walls: 'all' });
    expect(parsed.room).toMatchObject({ lengthM: 6, widthM: 4, heightM: 2.6, doors: 1, windows: 1 });
  });

  it('needs a length and width for a measured room', () => {
    const result = consultSchema.safeParse({ size: 'custom', length: '', width: '40' });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['length', 'width']));
    const ok = consultSchema.parse({ size: 'custom', length: '4,5', width: '3', height: '2.7', walls: 'feature' });
    expect(ok.room).toMatchObject({ lengthM: 4.5, widthM: 3, heightM: 2.7, walls: 'feature' });
  });

  it('falls back to sensible values for odd input', () => {
    const parsed = consultSchema.parse({ roomType: 'Spaceship', size: 'huge', walls: 'ceiling', doors: '99' });
    expect(parsed.roomType).toBe('Other');
    expect(parsed.room.walls).toBe('all');
    expect(parsed.room.doors).toBe(1);
  });
});

describe('photo upload', () => {
  it('accepts JPEG, PNG and WebP under 4 MB', async () => {
    const ok = await photoDataUrl(new File([new Uint8Array([1, 2, 3])], 'room.jpg', { type: 'image/jpeg' }));
    expect(ok.dataUrl).toBe('data:image/jpeg;base64,AQID');
    expect((await photoDataUrl(new File(['x'], 'room.heic', { type: 'image/heic' }))).error).toMatch(/JPEG, PNG or WebP/);
    expect((await photoDataUrl(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }))).error).toMatch(/too big/);
    expect(await photoDataUrl(null)).toEqual({ dataUrl: null });
  });
});

describe('brief-based picks', () => {
  it('reads the brief', () => {
    expect(familiesFor('calm bedroom').slice(0, 3)).toEqual(['green', 'blue', 'neutral']);
    expect(familiesFor('a bold, moody feature wall')[0]).toBe('deep');
  });

  it('gives three different colours, from different brands where it can', () => {
    const picks = rulePicks('calm and warm', 'Bedroom');
    expect(picks).toHaveLength(3);
    expect(new Set(picks.map((p) => p.colour.id)).size).toBe(3);
    expect(new Set(picks.map((p) => p.colour.brand)).size).toBe(3);
    expect(picks.every((p) => p.product.brand === p.colour.brand)).toBe(true);
  });

  it('chooses a washable finish for kitchens', () => {
    const picks = rulePicks('fresh', 'Kitchen');
    expect(picks.some((p) => /sheen|silk|satin/.test(p.product.finish))).toBe(true);
  });
});

describe('consult', () => {
  const input = {
    brief: 'calm',
    roomType: 'Bedroom',
    room: { lengthM: 4, widthM: 4, heightM: 2.6, walls: 'all' as const, doors: 1, windows: 1 },
    imageDataUrl: null,
  };

  it('uses the rules, priced for the room, when no key is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const fetchImpl = vi.fn();
    const result = await consult(input, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.source).toBe('rules');
    expect(result.aiUnavailable).toBe(false);
    expect(result.suggestions).toHaveLength(3);
    for (const s of result.suggestions) {
      expect(s.estimate.areaM2).toBe(38.2);
      expect(s.estimate.mix.totalLitres).toBeGreaterThanOrEqual(s.estimate.litres);
      expect(s.estimate.mix.totalCents).toBeGreaterThan(0);
    }
  });

  it('falls back to the rules, and says so, when the AI fails', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const fetchImpl = vi.fn(async () => new Response('down', { status: 503 }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await consult(input, fetchImpl as unknown as typeof fetch);
    expect(result.source).toBe('rules');
    expect(result.aiUnavailable).toBe(true);
    expect(result.suggestions).toHaveLength(3);
    errors.mockRestore();
  });
});

describe('rate limit', () => {
  it('allows eight consultations per ten minutes per address', () => {
    const now = Date.now();
    for (let i = 0; i < 8; i++) expect(allowConsult('10.0.0.1', now + i)).toBe(true);
    expect(allowConsult('10.0.0.1', now + 9)).toBe(false);
    expect(allowConsult('10.0.0.2', now + 9)).toBe(true);
    expect(allowConsult('10.0.0.1', now + 11 * 60 * 1000)).toBe(true);
  });
});
