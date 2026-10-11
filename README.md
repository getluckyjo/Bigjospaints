# Big Jo’s Paints

An online shop for South Africa’s top paint brands, with an AI colour consultant. A customer uploads a photo of a room, writes a short brief and gives the room size. The site suggests three colours, each with the brand, the paint, how many litres and tins, and the cost. They buy online, pay with PayFast, and the paint is delivered in 3 days.

Built with the Big Jo’s brand (same palette, type, icons and logo, with a “PAINTS” descriptor). Astro on Vercel, OpenAI for the consultant, PayFast for payments, Supabase for orders, Resend for email.

## Run it locally

```bash
npm install
cp .env.example .env      # works as is: demo AI, sandbox payments, in-memory orders
ORDER_STORE=memory npm run dev
```

Open http://localhost:4321. Without `OPENAI_API_KEY` the consultant still works: it picks three catalogue colours from the brief by simple rules and says so on the page.

## Checks

| Command | What it does |
|---|---|
| `npm test` | Unit tests: paint maths, catalogue, cart, AI request/response, checkout, PayFast and ITN |
| `npm run test:e2e` | Browser tests: every page at 320–1440 px with axe, the consultant against a mock OpenAI, cart, checkout to a stubbed PayFast, no-JS use, security |
| `npm run build` | Launch check, `astro check`, then the build |

## How the colour consultant works

1. **The form** (`/colour-consultant`) asks for a photo, a brief (with idea chips) and the room size (small, medium or large presets, or measurements; all walls or a feature wall; ceiling height, doors and windows). Without JavaScript the form posts as normal, for photos up to 4 MB. With JavaScript the photo is shrunk on the phone to 1600 px before upload, and results load in place.
2. **The AI** (`src/lib/ai.ts`) calls OpenAI’s Responses API with model `gpt-5.5` and reasoning effort `low`. It sends the photo, the brief, the room and the catalogue. A **strict JSON schema** limits every colour and paint to ids in `src/data/catalogue.json`, so the AI can’t invent a colour, a code or a price. The server checks every id again, and swaps a paint from the wrong brand for the colour’s own brand.
3. **The maths** (`src/lib/estimate.ts`) works out the wall area, then the litres (2 coats plus 10% extra), then the cheapest mix of tins. Prices come only from the catalogue, never from the AI.
4. **If the AI is off or fails**, `src/lib/rules.ts` picks three colours from the brief by keyword rules, and the page says so.
5. **Photos** go to OpenAI only to get suggestions. They aren’t stored (`store: false`), and OpenAI doesn’t use API data for training.
6. **Cost control:** each address can ask for 8 consultations per 10 minutes, per server instance. Each consultation is one `gpt-5.5` call: the photo plus about 3,000 tokens of instructions and catalogue in, and a short JSON answer out. Set a monthly budget and watch usage in the OpenAI dashboard.

## The catalogue (`src/data/catalogue.json`)

This file is the only source of colours and prices. It was built on 11 Oct 2026 from research:

- **Colours:** 70 colours from Plascon, Dulux, Duram and Prominent. Names and codes come from each brand’s current range, and swatch hex values from the brand’s own website.
- **Paints:** 10 interior wall paints, with tin sizes and regular (non-promotional) retail prices incl. VAT. Prices come from Builders, and from Prominent’s own shop for Prominent. Coverage comes from each brand’s data sheet, capped at 10 m²/L because Plascon quotes a theoretical rate.
- **Tint bases:** darker colours are mixed in a deeper base that costs more. Each colour has a base estimated from its lightness, and is priced from that base’s tins where the brand sells one.
- **Not included yet:**
  - Fired Earth: its colours couldn’t be verified online.
  - Earthcote: no standard interior emulsion.
  - Dulux EasyCare: no tint-base prices.

**Before launch, set your own selling prices in this file.** The research prices are a starting point, not your price list.

## Payments and orders

The checkout flow is the same as Big Jo’s Beds:

- The cart is a cookie holding only ids and quantities, re-priced from the catalogue on every page.
- Checkout creates an order, and the customer is sent to PayFast with a signed form.
- PayFast’s ITN (`/api/payfast/itn`) marks the order paid only when every check passes: signature, source IP, merchant, amount, and server confirmation.
- Paid orders email the customer and the owner. The owner’s email gives a “deliver by” date 3 days out.

## Commerce modes

- `sandbox` (default): test shop with a banner, PayFast sandbox, `noindex`.
- `live`: real payments. The build fails until every launch input below is supplied.

## Launch inputs still needed

- [ ] `OPENAI_API_KEY` in Vercel (Production, type Sensitive). Without it the consultant runs in demo mode.
- [ ] Your selling prices in `src/data/catalogue.json`.
- [ ] Delivery fee in `src/config/business.json → delivery.feeCents` (0 for free), and where you deliver.
- [ ] Legal name, registration number, physical address and email in `src/config/business.json` (ECTA s43).
- [ ] Terms of sale, delivery and returns, and privacy notice as `src/content/policies/*.md`.
- [ ] PayFast live merchant ID, key and passphrase (Vercel Production, Sensitive).
- [ ] Supabase project with `supabase/migrations/0001_init.sql` applied, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Resend sending domain, `RESEND_API_KEY`, `EMAIL_FROM` and `OWNER_EMAIL`.
- [ ] Confirm the WhatsApp number (Johannes’s own number, carried over from Big Jo’s Beds).
- [ ] A domain, then `PUBLIC_SITE_URL`.

## Where things live

| Path | What it is |
|---|---|
| `src/data/catalogue.json` | Brands, paints (tins, prices, coverage) and colours |
| `src/content/copy.json` | Site copy (draft for owner review) |
| `src/config/business.json` | Business details and delivery (3 days; fee to be set) |
| `src/lib/ai.ts`, `rules.ts`, `consult.ts` | The colour consultant |
| `src/lib/estimate.ts` | Wall area, litres and tin mix |
| `src/lib/cart.ts`, `checkout.ts`, `payfast.ts`, `itn.ts`, `orders.ts` | Shop and payments |
| `public/logos/` | The Big Jo’s Paints logo (`npm run logos` makes the variants) |
| `tests/e2e/mock-openai.mjs` | Local stand-in for OpenAI used by the browser tests |
