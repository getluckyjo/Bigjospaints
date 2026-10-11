import { afterEach, describe, expect, it, vi } from 'vitest';
import { getColour } from '../../src/lib/catalogue';
import {
  allowPreview,
  allowToken,
  handlePreviewPost,
  issuePreviewToken,
  photoHash,
  previewPrompt,
  previewSecret,
  previewSize,
  repaint,
  signPreviewToken,
  verifyPreviewToken,
} from '../../src/lib/preview';
import { aiConfig } from '../../src/lib/config';

afterEach(() => {
  vi.unstubAllEnvs();
});

const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const DATA_URL = `data:image/jpeg;base64,${Buffer.from(PHOTO).toString('base64')}`;
const COLOURS = ['plascon-desert-spring', 'dulux-sahara-drive', 'duram-tree-fern'];
const EDITED = Buffer.from('edited jpeg');

const okFetch = () =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: EDITED.toString('base64') }] })));

function previewRequest(fields: Record<string, string | Blob>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request('http://localhost/api/preview', { method: 'POST', body });
}

const photoFile = (bytes = PHOTO, type = 'image/jpeg') => new File([bytes], 'room.jpg', { type });

describe('preview token', () => {
  const secret = Buffer.from('test secret');
  const grant = { photo: photoHash(Buffer.from(PHOTO)), colours: COLOURS, walls: 'all' as const };

  it('round-trips and expires after 30 minutes', () => {
    const now = Date.UTC(2026, 9, 11, 12);
    const token = signPreviewToken(grant, secret, now);
    expect(verifyPreviewToken(token, secret, now)).toMatchObject(grant);
    expect(verifyPreviewToken(token, secret, now + 29 * 60 * 1000)).not.toBeNull();
    expect(verifyPreviewToken(token, secret, now + 31 * 60 * 1000)).toBeNull();
  });

  it('rejects a token that was changed or signed with another key', () => {
    const token = signPreviewToken(grant, secret);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...grant, colours: ['plascon-anything'], exp: 9_999_999_999 })).toString('base64url');
    expect(verifyPreviewToken(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifyPreviewToken(token, Buffer.from('other secret'))).toBeNull();
    expect(verifyPreviewToken(`${payload}.${sig}.x`, secret)).toBeNull();
    expect(verifyPreviewToken('', secret)).toBeNull();
    expect(verifyPreviewToken('nonsense', secret)).toBeNull();
  });

  it('uses PREVIEW_SECRET, else a key derived from the OpenAI key, else none', () => {
    expect(previewSecret({ PREVIEW_SECRET: ' abc ' })).toEqual(Buffer.from('abc'));
    const derived = previewSecret({ OPENAI_API_KEY: 'sk-test' });
    expect(derived).toHaveLength(32);
    expect(derived!.equals(Buffer.from('sk-test'))).toBe(false);
    expect(previewSecret({})).toBeNull();
  });

  it('is only issued with a photo and an OpenAI key', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PREVIEW_SECRET', '');
    expect(issuePreviewToken(DATA_URL, COLOURS, 'all')).toBeNull();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    expect(issuePreviewToken(null, COLOURS, 'all')).toBeNull();
    const token = issuePreviewToken(DATA_URL, COLOURS, 'feature')!;
    expect(verifyPreviewToken(token, previewSecret()!)).toMatchObject({ photo: photoHash(Buffer.from(PHOTO)), colours: COLOURS, walls: 'feature' });
  });
});

describe('preview size', () => {
  it('keeps the photo’s shape at about a megapixel, in multiples of 16', () => {
    for (const [w, h] of [
      [1600, 1067],
      [1067, 1600],
      [1600, 900],
      [1200, 1200],
      [4000, 3000],
    ]) {
      const [ow, oh] = previewSize(w, h).split('x').map(Number);
      expect(ow % 16).toBe(0);
      expect(oh % 16).toBe(0);
      expect(Math.abs(ow / oh - w / h)).toBeLessThan(0.03);
      expect(ow * oh).toBeGreaterThan(1024 * 1024 * 0.95);
      expect(ow * oh).toBeLessThan(1024 * 1024 * 1.05);
    }
    expect(previewSize(1200, 1200)).toBe('1024x1024');
  });

  it('falls back to square for a missing size and limits extreme shapes', () => {
    expect(previewSize(NaN, 800)).toBe('1024x1024');
    expect(previewSize(0, 0)).toBe('1024x1024');
    const [w, h] = previewSize(5000, 500).split('x').map(Number);
    expect(w / h).toBeCloseTo(2, 1);
  });
});

describe('preview prompt', () => {
  it('names the colour and says to keep everything else', () => {
    const colour = getColour('plascon-desert-spring')!;
    const all = previewPrompt(colour, 'all');
    expect(all).toContain(colour.name);
    expect(all).toContain('Plascon');
    expect(all).toContain(colour.hex);
    expect(all).toMatch(/every wall/);
    expect(all).toMatch(/Keep everything else exactly as it is/);
    expect(all).toMatch(/do not add any text/);
    expect(previewPrompt(colour, 'feature')).toMatch(/only the main wall/);
  });
});

describe('repaint', () => {
  it('sends the photo to the image edits endpoint and returns the image', async () => {
    const cfg = { ...aiConfig({ OPENAI_API_KEY: 'sk-test' }), imageModel: 'image-model', imageQuality: 'medium' as const };
    const fetchImpl = okFetch();
    const image = await repaint(new Blob([PHOTO], { type: 'image/jpeg' }), getColour(COLOURS[2])!, 'all', '1248x832', 'user-hash', cfg, fetchImpl);
    expect(image.equals(EDITED)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = init!.body as FormData;
    expect(body.get('model')).toBe('image-model');
    expect(body.get('size')).toBe('1248x832');
    expect(body.get('quality')).toBe('medium');
    expect(body.get('output_format')).toBe('jpeg');
    expect(body.get('user')).toBe('user-hash');
    expect(String(body.get('prompt'))).toContain('Tree Fern');
    expect(body.get('image[]')).toBeInstanceOf(Blob);
    expect((body.get('image[]') as File).name).toBe('room.jpg');
    await repaint(new Blob([PHOTO], { type: 'image/png' }), getColour(COLOURS[2])!, 'all', '1024x1024', 'u', cfg, fetchImpl);
    expect(((fetchImpl.mock.calls[1][1]!.body as FormData).get('image[]') as File).name).toBe('room.png');
  });

  it('turns a safety refusal into 422 and other failures into 502', async () => {
    const cfg = aiConfig({ OPENAI_API_KEY: 'sk-test' });
    const colour = getColour(COLOURS[0])!;
    const blob = new Blob([PHOTO], { type: 'image/jpeg' });
    const refused = vi.fn(async () => new Response('{"error":{"code":"moderation_blocked"}}', { status: 400 }));
    await expect(repaint(blob, colour, 'all', '1024x1024', 'u', cfg, refused)).rejects.toMatchObject({ status: 422 });
    const down = vi.fn(async () => new Response('busy', { status: 500 }));
    await expect(repaint(blob, colour, 'all', '1024x1024', 'u', cfg, down)).rejects.toMatchObject({ status: 502 });
    const empty = vi.fn(async () => new Response('{"data":[]}'));
    await expect(repaint(blob, colour, 'all', '1024x1024', 'u', cfg, empty)).rejects.toMatchObject({ status: 502 });
    await expect(repaint(blob, colour, 'all', '1024x1024', 'u', aiConfig({}), okFetch())).rejects.toMatchObject({ status: 503 });
  });
});

describe('POST /api/preview', () => {
  const setup = () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('PREVIEW_SECRET', 'preview secret');
    return issuePreviewToken(DATA_URL, COLOURS, 'all')!;
  };

  it('repaints the consultation’s photo in one of its colours', async () => {
    const token = setup();
    const fetchImpl = okFetch();
    const res = await handlePreviewPost(
      previewRequest({ token, colour: COLOURS[1], photo: photoFile(), width: '1600', height: '1067' }),
      '10.1.0.1',
      fetchImpl,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer()).equals(EDITED)).toBe(true);
    const body = fetchImpl.mock.calls[0][1]!.body as FormData;
    expect(body.get('size')).toBe(previewSize(1600, 1067));
    expect(String(body.get('prompt'))).toContain('Sahara Drive');
  });

  it('refuses anything outside the token, without calling OpenAI', async () => {
    const token = setup();
    const fetchImpl = okFetch();
    const post = (fields: Record<string, string | Blob>) => handlePreviewPost(previewRequest(fields), '10.1.0.2', fetchImpl);
    expect((await post({ token: 'bad', colour: COLOURS[0], photo: photoFile() })).status).toBe(403);
    expect((await post({ token, colour: 'plascon-not-suggested', photo: photoFile() })).status).toBe(400);
    expect((await post({ token, colour: COLOURS[0] })).status).toBe(400);
    expect((await post({ token, colour: COLOURS[0], photo: photoFile(PHOTO, 'image/gif') })).status).toBe(400);
    const other = await post({ token, colour: COLOURS[0], photo: photoFile(new Uint8Array([9, 9, 9])) });
    expect(other.status).toBe(403);
    expect((await other.json()).error).toMatch(/isn’t the photo/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is off without an OpenAI key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PREVIEW_SECRET', '');
    const res = await handlePreviewPost(previewRequest({ token: 'x' }), '10.1.0.3', okFetch());
    expect(res.status).toBe(503);
  });

  it('reports a failed edit as JSON', async () => {
    const token = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = vi.fn(async () => new Response('{"error":{"message":"safety system"}}', { status: 400 }));
    const res = await handlePreviewPost(previewRequest({ token, colour: COLOURS[0], photo: photoFile() }), '10.1.0.4', refused);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/another photo/);
    errors.mockRestore();
  });
});

describe('preview rate limit', () => {
  it('allows thirty previews per ten minutes per address', () => {
    const now = Date.now();
    for (let i = 0; i < 30; i++) expect(allowPreview('10.9.0.1', now + i)).toBe(true);
    expect(allowPreview('10.9.0.1', now + 31)).toBe(false);
    expect(allowPreview('10.9.0.2', now + 31)).toBe(true);
    expect(allowPreview('10.9.0.1', now + 11 * 60 * 1000)).toBe(true);
  });

  it('allows six previews per token, from any address', () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) expect(allowToken('token-a', now + i)).toBe(true);
    expect(allowToken('token-a', now + 7)).toBe(false);
    expect(allowToken('token-b', now + 7)).toBe(true);
  });
});
