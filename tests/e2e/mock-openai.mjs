// A stand-in for OpenAI's Responses API, for browser tests. It answers POST /v1/responses with
// three catalogue colours (the first three of different brands), records the last request for
// inspection at GET /last, and fails with a 500 when the brief contains "trigger-error".
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 4599);
const catalogue = JSON.parse(fs.readFileSync(new URL('../../src/data/catalogue.json', import.meta.url), 'utf8'));
let last = null;

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
    if (req.method === 'GET') {
      res.writeHead(200);
      res.end('ok');
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
