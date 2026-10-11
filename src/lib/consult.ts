/**
 * Runs a colour consultation: validates the form, asks the AI (or the brief-based rules when it's
 * not connected or fails), and prices each suggestion for the customer's room.
 */
import { z } from 'zod';
import { askOpenAI, type ConsultInput, type ConsultResult, type Suggestion } from './ai';
import { aiConfig } from './config';
import { DEFAULT_HEIGHT_M, ROOM_PRESETS, estimate, type Estimate, type Room } from './estimate';
import { rulePicks } from './rules';
import { sizesFor } from './catalogue';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const ROOM_TYPES = [
  'Bedroom',
  'Main bedroom',
  'Lounge',
  'Kitchen',
  'Dining room',
  'Bathroom',
  "Children's room",
  'Study',
  'Passage or entrance',
  'Other',
] as const;

export const BRIEF_IDEAS = ['Calm and restful', 'Warm and cosy', 'Bright and airy', 'Earthy and natural', 'Bold feature wall', 'Modern and minimal'];

const num = (min: number, max: number, message: string) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : Number(String(v).replace(',', '.'))), z.number({ error: message }).min(min, message).max(max, message));

export const consultSchema = z
  .object({
    brief: z.string().trim().max(600, 'Keep the brief under 600 characters.').default(''),
    roomType: z.enum(ROOM_TYPES).catch('Other'),
    size: z.enum(['small', 'medium', 'large', 'custom']).catch('medium'),
    length: z.unknown().optional(),
    width: z.unknown().optional(),
    height: num(2, 5, 'Enter a ceiling height between 2 and 5 m.').catch(DEFAULT_HEIGHT_M),
    walls: z.enum(['all', 'feature']).catch('all'),
    doors: z.preprocess((v) => Number(v ?? 1), z.number().int().min(0).max(6)).catch(1),
    windows: z.preprocess((v) => Number(v ?? 1), z.number().int().min(0).max(10)).catch(1),
  })
  .transform((d, ctx) => {
    let lengthM: number;
    let widthM: number;
    if (d.size === 'custom') {
      const l = num(1, 20, 'Enter a length between 1 and 20 m.').safeParse(d.length);
      const w = num(1, 20, 'Enter a width between 1 and 20 m.').safeParse(d.width);
      if (!l.success) ctx.addIssue({ code: 'custom', path: ['length'], message: l.error.issues[0].message });
      if (!w.success) ctx.addIssue({ code: 'custom', path: ['width'], message: w.error.issues[0].message });
      if (!l.success || !w.success) return z.NEVER;
      lengthM = l.data;
      widthM = w.data;
    } else {
      ({ lengthM, widthM } = ROOM_PRESETS[d.size]);
    }
    const room: Room = { lengthM, widthM, heightM: d.height, walls: d.walls, doors: d.doors, windows: d.windows };
    return { brief: d.brief, roomType: d.roomType, size: d.size, room };
  });

export type ConsultForm = z.infer<typeof consultSchema>;

export interface PricedSuggestion extends Suggestion {
  estimate: Estimate;
}

export interface Consultation extends Omit<ConsultResult, 'suggestions'> {
  suggestions: PricedSuggestion[];
  /** Set when the AI was asked but couldn't answer, so the rules stepped in. */
  aiUnavailable: boolean;
  room: Room;
}

export function priceSuggestions(suggestions: Suggestion[], room: Room): PricedSuggestion[] {
  return suggestions.map((s) => ({ ...s, estimate: estimate(room, { ...s.product, sizes: sizesFor(s.product, s.colour) }) }));
}

export async function consult(input: ConsultInput, fetchImpl: typeof fetch = fetch): Promise<Consultation> {
  const cfg = aiConfig();
  const fallback = () => rulePicks(input.brief, input.roomType);
  let result: ConsultResult;
  let aiUnavailable = false;
  if (cfg.apiKey) {
    try {
      result = await askOpenAI(input, cfg, fallback, fetchImpl);
    } catch (error) {
      console.error('[consult] AI failed, using brief-based picks:', (error as Error).message);
      aiUnavailable = true;
      result = rulesResult(input);
    }
  } else {
    result = rulesResult(input);
  }
  return { ...result, aiUnavailable, room: input.room, suggestions: priceSuggestions(result.suggestions, input.room) };
}

function rulesResult(input: ConsultInput): ConsultResult {
  return {
    source: 'rules',
    roomRead: '',
    photoIssue: null,
    suggestions: rulePicks(input.brief, input.roomType),
  };
}

/** Read an uploaded photo into a data: URL for the AI. Returns an error message for bad files. */
export async function photoDataUrl(file: unknown): Promise<{ dataUrl: string | null; error?: string }> {
  if (!(file instanceof File) || file.size === 0) return { dataUrl: null };
  if (!IMAGE_TYPES.includes(file.type)) {
    return { dataUrl: null, error: 'Please use a JPEG, PNG or WebP photo. On an iPhone, choose "Most Compatible" or take the photo from this page.' };
  }
  if (file.size > MAX_IMAGE_BYTES) return { dataUrl: null, error: 'That photo is too big. Please use one under 4 MB.' };
  const bytes = Buffer.from(await file.arrayBuffer());
  return { dataUrl: `data:${file.type};base64,${bytes.toString('base64')}` };
}

// ---------- Simple per-instance rate limit (the AI costs money per request) ----------

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 8;
const hits = new Map<string, number[]>();

export function allowConsult(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

// ---------- The consultant page's form post ----------

export interface ConsultPageState {
  values: Record<string, string>;
  errors: Record<string, string>;
  result: Consultation | null;
  /** The photo as sent, shown beside the results. */
  photoUrl: string | null;
  formError: string | null;
  status?: number;
}

export async function handleConsultPost(request: Request, ip: string, fetchImpl: typeof fetch = fetch): Promise<ConsultPageState> {
  const state: ConsultPageState = { values: {}, errors: {}, result: null, photoUrl: null, formError: null };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ...state, formError: 'We couldn’t read that upload. Please try a smaller photo.', status: 400 };
  }
  for (const [key, value] of form.entries()) if (typeof value === 'string') state.values[key] = value;
  if (state.values.website) return { ...state, formError: 'Something went wrong. Please try again.', status: 400 };

  const parsed = consultSchema.safeParse(state.values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) state.errors[String(issue.path[0] ?? 'form')] ??= issue.message;
    return { ...state, status: 422 };
  }
  const photo = await photoDataUrl(form.get('photo'));
  if (photo.error) return { ...state, errors: { photo: photo.error }, status: 422 };
  if (!allowConsult(ip)) {
    return { ...state, formError: 'You’ve asked for a lot of colours in a short time. Please wait a few minutes and try again.', status: 429 };
  }
  const { brief, roomType, room } = parsed.data;
  state.photoUrl = photo.dataUrl;
  state.result = await consult({ brief, roomType, room, imageDataUrl: photo.dataUrl }, fetchImpl);
  return state;
}
