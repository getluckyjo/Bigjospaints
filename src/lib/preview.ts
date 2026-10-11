/**
 * "See it in your room": OpenAI's image model repaints the walls in the customer's own photo, once
 * for each suggested colour. The result is an AI mock-up, and the page says so.
 *
 * Each image edit costs money, so the endpoint only works with a token the consultation signs: it
 * ties the request to the exact photo (by SHA-256), the three suggested colours and a 30-minute
 * window. The prompt is built here from the catalogue; nothing the customer types reaches it.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getBrand, getColour, type Colour } from './catalogue';
import { describe } from './colour-science';
import { aiConfig, type AiConfig } from './config';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './consult';

const TOKEN_TTL_S = 30 * 60;

type Env = Record<string, string | undefined>;

/** The key for preview tokens: PREVIEW_SECRET if set, else derived from the OpenAI key. Null when previews are off. */
export function previewSecret(env: Env = process.env): Buffer | null {
  if (env.PREVIEW_SECRET?.trim()) return Buffer.from(env.PREVIEW_SECRET.trim());
  const key = env.OPENAI_API_KEY?.trim();
  return key ? createHmac('sha256', key).update('big-jos-paints preview token v1').digest() : null;
}

export interface PreviewGrant {
  /** SHA-256 of the photo, base64url. */
  photo: string;
  colours: string[];
  walls: 'all' | 'feature';
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
export const photoHash = (bytes: Buffer) => b64url(createHash('sha256').update(bytes).digest());

export function signPreviewToken(grant: Omit<PreviewGrant, 'exp'>, secret: Buffer, now = Date.now()): string {
  const payload = b64url(Buffer.from(JSON.stringify({ ...grant, exp: Math.floor(now / 1000) + TOKEN_TTL_S })));
  return `${payload}.${b64url(createHmac('sha256', secret).update(payload).digest())}`;
}

/** A token for the consultation's three colours and photo (a data: URL), or null when previews are off. */
export function issuePreviewToken(photoDataUrl: string | null, colourIds: string[], walls: 'all' | 'feature'): string | null {
  const secret = previewSecret();
  if (!photoDataUrl || !secret || !aiConfig().apiKey) return null;
  const bytes = Buffer.from(photoDataUrl.slice(photoDataUrl.indexOf(',') + 1), 'base64');
  return signPreviewToken({ photo: photoHash(bytes), colours: colourIds, walls }, secret);
}

export function verifyPreviewToken(token: string, secret: Buffer, now = Date.now()): PreviewGrant | null {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PreviewGrant;
    if (typeof grant.exp !== 'number' || grant.exp * 1000 < now) return null;
    if (typeof grant.photo !== 'string' || !Array.isArray(grant.colours)) return null;
    return grant;
  } catch {
    return null;
  }
}

/**
 * The output size: the photo's shape at about one megapixel (the cost of a 1024 × 1024 image),
 * in multiples of 16 as the model requires. Unknown or extreme shapes fall back to square.
 */
export function previewSize(width: number, height: number): string {
  if (!(width > 0 && height > 0)) return '1024x1024';
  const ratio = Math.min(2, Math.max(0.5, width / height));
  const w = Math.round(Math.sqrt(1024 * 1024 * ratio) / 16) * 16;
  const h = Math.round(w / ratio / 16) * 16;
  return `${w}x${h}`;
}

export function previewPrompt(colour: Colour, walls: 'all' | 'feature'): string {
  const brand = getBrand(colour.brand)?.name ?? '';
  const name = `${colour.name}${colour.code ? ` (${colour.code})` : ''} by ${brand}`;
  const which =
    walls === 'feature'
      ? 'Paint only the main wall facing the camera in this colour, and leave the other walls as they are.'
      : 'Paint every wall in the room evenly in this colour.';
  return [
    `Repaint the walls in this photo of a room in the paint colour ${name}: a ${describe(colour.hex)}, close to hex ${colour.hex}, in a flat matt finish.`,
    which,
    'Keep everything else exactly as it is in the photo: the furniture, floor, ceiling, windows, doors, frames and skirting, built-in cupboards and shelves, plants, artwork, objects and people, and the camera angle, framing and lighting.',
    "Keep the walls' natural light, shadows and texture so the new paint looks real. Do not add, remove, move or restyle anything, and do not add any text.",
    'Photorealistic.',
  ].join(' ');
}

export class PreviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Ask OpenAI's image model to repaint the walls. Returns the JPEG bytes. */
export async function repaint(
  photo: Blob,
  colour: Colour,
  walls: 'all' | 'feature',
  size: string,
  user: string,
  cfg: AiConfig = aiConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  if (!cfg.apiKey) throw new PreviewError('Previews are off', 503);
  const body = new FormData();
  body.set('model', cfg.imageModel);
  body.set('prompt', previewPrompt(colour, walls));
  body.set('image[]', photo, `room.${{ 'image/png': 'png', 'image/webp': 'webp' }[photo.type] ?? 'jpg'}`);
  body.set('size', size);
  body.set('quality', cfg.imageQuality);
  body.set('output_format', 'jpeg');
  body.set('output_compression', '85');
  body.set('n', '1');
  body.set('user', user);
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body,
      signal: AbortSignal.timeout(170_000),
    });
  } catch (error) {
    throw new PreviewError(`Request failed: ${(error as Error).message}`, 502);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // A photo the image model won't edit (its safety system) is the customer's to change.
    const blocked = res.status === 400 && /moderation|safety/i.test(detail);
    throw new PreviewError(`OpenAI ${res.status}: ${detail.slice(0, 300)}`, blocked ? 422 : 502);
  }
  const json = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new PreviewError('No image in the response', 502);
  // Token counts, so the cost of each preview shows in the logs (rates in README "AI previews").
  if (json.usage) console.info('[preview] tokens', { in: json.usage.input_tokens, out: json.usage.output_tokens, quality: cfg.imageQuality, size });
  return Buffer.from(b64, 'base64');
}

// ---------- Per-instance rate limit: each preview is a paid image edit ----------

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 30;
/** Each token covers three previews; this leaves room for a retry of each, not for reuse. */
const TOKEN_LIMIT = 6;
const hits = new Map<string, number[]>();

function allow(key: string, limit: number, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

export const allowPreview = (ip: string, now = Date.now()) => allow(`ip:${ip}`, LIMIT, now);
export const allowToken = (token: string, now = Date.now()) => allow(`token:${token}`, TOKEN_LIMIT, now);

const fail = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** POST /api/preview: token, colour, photo (the same file the consultation saw), width and height. */
export async function handlePreviewPost(request: Request, ip: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const secret = previewSecret();
  if (!secret || !aiConfig().apiKey) return fail('Previews are switched off.', 503);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('We couldn’t read that request.', 400);
  }
  const token = String(form.get('token') ?? '');
  const grant = verifyPreviewToken(token, secret);
  if (!grant) return fail('This preview link has expired. Ask for your colours again.', 403);
  const colourId = String(form.get('colour') ?? '');
  const colour = grant.colours.includes(colourId) ? getColour(colourId) : undefined;
  if (!colour) return fail('That colour wasn’t part of your consultation.', 400);
  const photo = form.get('photo');
  if (!(photo instanceof File) || !IMAGE_TYPES.includes(photo.type) || photo.size === 0 || photo.size > MAX_IMAGE_BYTES) {
    return fail('We couldn’t read your photo.', 400);
  }
  const bytes = Buffer.from(await photo.arrayBuffer());
  if (photoHash(bytes) !== grant.photo) return fail('That isn’t the photo from your consultation.', 403);
  if (!allowPreview(ip) || !allowToken(token)) return fail('You’ve asked for a lot of previews in a short time. Please wait a few minutes.', 429);

  const size = previewSize(Number(form.get('width')), Number(form.get('height')));
  const user = createHash('sha256').update(`bjp:${ip}`).digest('hex').slice(0, 32);
  try {
    const image = await repaint(new Blob([bytes], { type: photo.type }), colour, grant.walls, size, user, aiConfig(), fetchImpl);
    return new Response(new Uint8Array(image), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
  } catch (error) {
    const e = error as PreviewError;
    console.error('[preview]', e.message);
    return fail(e.status === 422 ? 'The image model couldn’t use this photo. Try another photo of the room.' : 'We couldn’t paint this preview just now.', e.status ?? 502);
  }
}
