// A stand-in for OpenAI, for browser tests. It answers POST /v1/responses with three catalogue
// colours (the first three of different brands), records the last request for inspection at
// GET /last, and fails with a 500 when the brief contains "trigger-error". POST /v1/images/edits
// returns a small sage-green JPEG and records the request at GET /last-edit.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 4599);
const catalogue = JSON.parse(fs.readFileSync(new URL('../../src/data/catalogue.json', import.meta.url), 'utf8'));
let last = null;
let lastEdit = null;
// A 96 × 64 sage-green JPEG.
const EDITED_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABAAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2iiiiucgKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==';

function pick() {
  const picks = [];
  for (const c of catalogue.colours) {
    if (picks.length === 3) break;
    if (picks.some((p) => p.colour.brand === c.brand)) continue;
    const product = catalogue.products.find((p) => p.brand === c.brand);
    picks.push({ colour: c, product });
  }
  return picks;
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/last') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(last));
      return;
    }
    if (req.method === 'GET' && req.url === '/last-edit') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(lastEdit));
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    if (req.url?.endsWith('/images/edits')) {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('latin1');
        const field = (name) => text.match(new RegExp(`name="${name.replace(/[[\]]/g, '\\$&')}"\\r\\n\\r\\n([^\\r]*)`))?.[1] ?? null;
        lastEdit = {
          authorization: req.headers.authorization,
          model: field('model'),
          prompt: field('prompt'),
          size: field('size'),
          quality: field('quality'),
          hasImage: /name="image\[\]"; filename=/.test(text),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ created: 0, data: [{ b64_json: EDITED_JPEG }], usage: { total_tokens: 0 } }));
      });
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      last = { headers: req.headers, body: JSON.parse(body) };
      const text = JSON.stringify(last.body.input?.[0]?.content?.[0]?.text ?? '');
      if (text.includes('trigger-error')) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":{"message":"mock failure"}}');
        return;
      }
      const output = {
        photo_issue: '',
        room_read: 'Soft morning light from the left, warm wooden floors and a cream bed.',
        options: pick().map(({ colour, product }, i) => ({
          colour_id: colour.id,
          product_id: product.id,
          title: ['Calm and grounded', 'Warm and light', 'Fresh and airy'][i],
          why: `Mock reason for ${colour.name}.`,
          tip: 'Keep the ceiling white to lift the room.',
        })),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'resp_mock',
          object: 'response',
          status: 'completed',
          output: [
            { type: 'reasoning', summary: [] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output) }] },
          ],
        }),
      );
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`mock OpenAI on ${port}`));
