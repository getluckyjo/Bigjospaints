import { describe, expect, it, vi } from 'vitest';
import { AiError, askOpenAI, buildRequest, outputText, responseSchema, toResult, type ConsultInput } from '../../src/lib/ai';
import { aiColours, colours, defaultProductFor, getProduct, products } from '../../src/lib/catalogue';
import type { AiConfig } from '../../src/lib/config';
import { rulePicks } from '../../src/lib/rules';

const cfg: AiConfig = { apiKey: 'sk-test', model: 'gpt-5.5', reasoningEffort: 'low', baseUrl: 'https://api.openai.test/v1' };
const input: ConsultInput = {
  brief: 'Calm and warm, oak floors',
  roomType: 'Lounge',
  room: { lengthM: 5, widthM: 4, heightM: 2.6, walls: 'all', doors: 1, windows: 2 },
  imageDataUrl: 'data:image/jpeg;base64,AAAA',
};
const fallback = () => rulePicks(input.brief, input.roomType);

const byBrand = (brand: string) => colours.find((c) => c.brand === brand)!;
const modelJson = (options: unknown[]) => ({ photo_issue: '', room_read: 'Warm light, oak floors.', options });
const responseWith = (text: string) => ({
  status: 'completed',
  output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }],
});

describe('request', () => {
  it('asks gpt-5.5 for strict JSON, with the photo and the room', () => {
    const body = buildRequest(input, cfg);
    expect(body.model).toBe('gpt-5.5');
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'colour_options', strict: true });
    const content = body.input[0].content;
    expect(content[0]).toMatchObject({ type: 'input_text' });
    expect(String(content[0].text)).toContain('Calm and warm, oak floors');
    expect(String(content[0].text)).toContain('5 × 4 m');
    expect(content[1]).toEqual({ type: 'input_image', image_url: input.imageDataUrl, detail: 'auto' });
    expect(body.instructions).toContain(colours[0].id);
  });

  it('leaves the image out when there is no photo', () => {
    expect(buildRequest({ ...input, imageDataUrl: null }, cfg).input[0].content).toHaveLength(1);
  });

  it('keeps the colour list within OpenAI’s structured-output limits', () => {
    // Up to 1,000 enum values in a schema; over 250 values, at most 15,000 characters in one enum.
    const ids = responseSchema().properties.options.items.properties.colour_id.enum;
    expect(ids.length + products.length).toBeLessThanOrEqual(1000);
    expect(ids.join('').length).toBeLessThanOrEqual(15000);
    expect(ids.length).toBeLessThan(colours.length);
  });

  it('only allows catalogue ids, and every property is required (strict mode)', () => {
    const schema = responseSchema();
    const item = schema.properties.options.items;
    expect(item.properties.colour_id.enum).toEqual(aiColours.map((c) => c.id));
    expect(item.properties.product_id.enum).toEqual(products.map((p) => p.id));
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(schema.additionalProperties).toBe(false);
    expect(item.additionalProperties).toBe(false);
  });
});

describe('response', () => {
  it('reads the output text', () => {
    expect(outputText(responseWith('{"a":1}'))).toBe('{"a":1}');
  });
  it('raises on a refusal or an incomplete answer', () => {
    expect(() => outputText({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] })).toThrow(AiError);
    expect(() => outputText({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })).toThrow(/max_output_tokens/);
    expect(() => outputText({ output: [] })).toThrow(AiError);
  });

  it('keeps valid picks, fixes a wrong-brand paint, drops duplicates and tops up to three', () => {
    const plascon = byBrand('plascon');
    const dulux = byBrand('dulux');
    const result = toResult(
      modelJson([
        { colour_id: plascon.id, product_id: defaultProductFor('dulux')!.id, title: 'Calm', why: 'Because.', tip: 'Tip.' },
        { colour_id: plascon.id, product_id: defaultProductFor('plascon')!.id, title: 'Dup', why: '', tip: '' },
        { colour_id: 'made-up-colour', product_id: 'made-up', title: 'Bad', why: '', tip: '' },
        { colour_id: dulux.id, product_id: defaultProductFor('dulux')!.id, title: 'Warm', why: 'W.', tip: 'T.' },
      ]) as never,
      fallback,
    );
    expect(result.source).toBe('ai');
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0].colour.id).toBe(plascon.id);
    expect(result.suggestions[0].product.brand).toBe('plascon');
    expect(result.suggestions[1].colour.id).toBe(dulux.id);
    expect(new Set(result.suggestions.map((s) => s.colour.id)).size).toBe(3);
    expect(result.photoIssue).toBeNull();
  });
});

describe('askOpenAI', () => {
  const three = () =>
    ['plascon', 'dulux', 'duram'].map((b) => ({
      colour_id: byBrand(b).id,
      product_id: defaultProductFor(b)!.id,
      title: 'Nice',
      why: 'Why.',
      tip: 'Tip.',
    }));

  it('posts to /responses with the key and returns three suggestions', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(responseWith(JSON.stringify(modelJson(three()))))));
    const result = await askOpenAI(input, cfg, fallback, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.test/v1/responses');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(result.suggestions.map((s) => s.colour.brand)).toEqual(['plascon', 'dulux', 'duram']);
    expect(result.suggestions.every((s) => getProduct(s.product.id))).toBe(true);
  });

  it('raises on HTTP errors, bad JSON and a missing key', async () => {
    const fail = vi.fn(async () => new Response('{"error":{}}', { status: 429 }));
    await expect(askOpenAI(input, cfg, fallback, fail as unknown as typeof fetch)).rejects.toThrow(/429/);
    const garbage = vi.fn(async () => new Response(JSON.stringify(responseWith('not json'))));
    await expect(askOpenAI(input, cfg, fallback, garbage as unknown as typeof fetch)).rejects.toThrow(/not JSON/);
    await expect(askOpenAI(input, { ...cfg, apiKey: null }, fallback)).rejects.toThrow(/OPENAI_API_KEY/);
  });
});
