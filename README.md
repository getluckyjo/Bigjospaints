# Big Jo’s Paints

An online shop for South Africa’s top paint brands, with an AI colour consultant. A customer uploads a photo of a room, writes a short brief and gives the room size. The site suggests three colours, each with the brand, the paint, how many litres and tins, and the cost. They buy online, pay with PayFast, and the paint is delivered in 3 days.

Built with the Big Jo’s brand (same palette, type, icons and logo, with a “PAINTS” descriptor). Astro on Vercel, OpenAI for the consultant, PayFast for payments, Supabase for orders, Resend for email.

## Status: paused until early 2027 (owner, 12 Oct 2026)

- **Live test shop:** https://bigjospaints.vercel.app (PayFast sandbox, no real payments, orders kept in memory only). Everything on it is in this repo up to commit 459ccc3 and later docs.
- **Deploying:** the Vercel project (bigjospaints) is not connected to this repo. Deploys were uploaded by hand from a session that no longer exists. To resume, connect the project to `getluckyjo/Bigjospaints` in Vercel and change its install command from `node unpack.mjs && npm ci` to `npm ci`; pushes to `main` then deploy.
- **Plan:** the Claude doc “Big Jo’s Paints: commercial model and operating plan” (https://claude.ai/code/artifact/ebbb8d13-4222-44d6-9667-05fe981f0f83) has the pricing, unit economics, partners, Cape Town merchant shortlist and go-live steps.
- **Next, in order:**
  1. Quotes from Cape Town tinting merchants (Dulux Paint Specialist Centre, Maitland; AA Paint, Durbanville; ask Brights Hardware). Their price lists set the selling prices and add the exterior paints.
  2. Build: send each paid order line to the merchant for its brand, delivery per parcel; switch off brands no merchant covers; outside painting (exterior paints, an outside-walls option and its maths, the consultant); prices and delivery fees from the plan.
  3. The launch inputs below.

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
2. **The AI** (`src/lib/ai.ts`) calls OpenAI’s Responses API with model `gpt-5.5` and reasoning effort `low`. It sends the photo, the brief, the room and the catalogue: every paint, and a shortlist of colours (the hand-picked ones plus each brand’s curated collection, not the full ranges, to keep each call small). A **strict JSON schema** limits every colour and paint to ids in the catalogue, so the AI can’t invent a colour, a code or a price. The server checks every id again, and swaps a paint from the wrong brand for the colour’s own brand.
3. **The maths** (`src/lib/estimate.ts`) works out the wall area, then the litres (2 coats plus 10% extra), then the cheapest mix of tins. Prices come only from the catalogue, never from the AI.
4. **If the AI is off or fails**, `src/lib/rules.ts` picks three colours from the brief by keyword rules, and the page says so.
5. **Photos** go to OpenAI only to get suggestions and paint the previews. We don’t store them (`store: false` on the consultation), and OpenAI doesn’t use API data for training.
6. **Cost control:** each address can ask for 8 consultations per 10 minutes, per server instance. Each consultation is one `gpt-5.5` call: the photo plus about 15,000 tokens of instructions and colour shortlist in (the same every time, so OpenAI caches most of it), and a short JSON answer out. Set a monthly budget and watch usage in the OpenAI dashboard.

### AI previews: “See it in your room”

When the customer sends a photo, the results page also shows their own room repainted in each of the three colours.

1. **The consultation signs a token** (`src/lib/preview.ts`): an HMAC of the photo’s SHA-256, the three colour ids, all walls or a feature wall, and a 30-minute expiry. The key is `PREVIEW_SECRET`, or one derived from `OPENAI_API_KEY`. Without a key there are no previews.
2. **The page** (`src/scripts/preview.ts`) sends the same photo with the token to `POST /api/preview` once per colour, all three at once. Each preview takes up to a minute. The first one to finish shows by itself, and buttons switch between the photo and each mock-up. Without JavaScript the panel stays hidden.
3. **The server** checks the token, that the colour is one of the three, and that the photo’s hash matches, so the endpoint can’t be used as a free image editor. It then calls OpenAI’s Images API (`/v1/images/edits`, model `gpt-image-2.5-sunburst`, quality `medium`) with a prompt built only from the catalogue: the colour’s name, brand, hex and a plain description, and matt finish. The prompt also asks the model to tidy the room (clutter such as papers, clothes, cables and dishes cleared away, cushions and bedding straightened) and to keep the furniture, where it stands, the plants, the shelves and the light as they are. Nothing the customer types reaches the prompt. The output keeps the photo’s shape at about one megapixel. Each address can ask for 30 previews per 10 minutes, and each token is good for 6 (three colours and a retry of each), per server instance.
4. **The page says what they are:** every preview is labelled “AI mock-up”, with a note that the model tidies the room and can change small details, and that a sample pot and test patch come first.
5. **Send on WhatsApp** (`src/scripts/preview-share.ts`): the browser draws a picture of the mock-up with its “AI mock-up” label and a band underneath: the colour, brand, code and paint, the cost to paint and the tins, the logo and the test-patch note. The details are in the picture because WhatsApp sometimes drops the text sent with an image. On phones the share sheet sends the picture with a message (the room, colour, paint, tins, cost and a link to the colour’s page); the customer picks WhatsApp and the chat. Where there’s no share sheet (most computers), the picture is saved and WhatsApp opens with the message, ready for the picture to be attached. The picture is made in the browser and never uploaded.
6. **Cost:** three image edits per consultation with a photo. GPT Image 2.5 costs $8 per million image tokens in and $30 per million out. On the live site (11 Oct 2026, a 1600 × 1190 photo, quality `medium`), each preview used about 1,650 tokens in and 329 out: at most US$0.023 per preview, or about US$0.07 for the three. They took about 22 seconds, all three at once. The server logs the token counts of every preview (`[preview] tokens` in the Vercel logs). `OPENAI_IMAGE_QUALITY` trades cost for detail: `low` is cheapest; `high`, `xhigh` and `max` cost more. Image edits can take more than a minute, so the server functions may run for up to 180 s (`maxDuration` in `astro.config.mjs`).

## The catalogue (`src/data/catalogue.json` and `src/data/colours/`)

These files are the only source of colours and prices. They were built on 11 Oct 2026 from research:

- **Colours:** each brand’s full interior range, in `src/data/colours/<brand>.json` as name, code, hex and collection, taken from the brand’s own colour data. Ready-mixed colours made for one product only are left out. `src/lib/colour-science.ts` works out each colour’s family (greens, blues and so on), tint base and a short description from its hex. 70 hand-picked colours in `catalogue.json` keep their own notes and families, and come first on `/colours`.
- **How many:** 5,430 colours: Plascon 1,631, Dulux 2,869, Duram 872 and Prominent 58. Prominent publishes colour values for only part of its range.
- **AI shortlist (324 colours):** the hand-picked colours plus Plascon’s Essential Collection, Duram’s Habitat Collection, Prominent’s palette and Dulux’s Colours of the Year 2026 and 2027 (`aiCollections` and `aiTags` in each brand file).
- **Sample pots:** the brands’ own testers, at retailer prices: Plascon Perfect Colour Matt (250 ml, R45, light colours) and Double Velvet (250 ml, R65, any colour), Duram Habitat (90 ml, R36, Habitat colours) and WallTech (250 ml, R59 to R89 by tint base). Each colour offers the cheapest pot that can take it. Dulux’s Luxurious Colour Tester (250 ml, R99) is offered for the 384 colours on Dulux’s in-store colour wall, the ones Dulux lists for it. Prominent makes no sample pots and suggests a 1 L tin instead, so its colour pages offer the 1 L tin. Duram’s Off-White colours can’t be tinted that small, so they have no sample either; colours without a pot offer the smallest tin.
- **Paints:** 10 interior wall paints, with tin sizes and regular (non-promotional) retail prices incl. VAT. Prices come from Builders, and from Prominent’s own shop for Prominent. Coverage comes from each brand’s data sheet, capped at 10 m²/L because Plascon quotes a theoretical rate.
- **Tint bases:** darker colours are mixed in a deeper base that costs more. Each colour has a base estimated from its lightness (Duram publishes its own, which is used instead), and is priced from that base’s tins where the brand sells one.
- **Not included yet:**
  - Fired Earth: its colours couldn’t be verified online.
  - Earthcote: no standard interior emulsion.
  - Dulux EasyCare: no tint-base prices.

**Before launch, set your own selling prices in this file.** The research prices are a starting point, not your price list.

## Photos

The site uses real photographs only, never renders or AI images. The owner chose them (11 Oct 2026) from Unsplash; they're free to use under the [Unsplash License](https://unsplash.com/license), and each one is credited to its photographer next to the photo (`src/lib/photos.ts`, `src/components/Photo.astro`). The files in `src/assets/photos/` were downloaded from Unsplash’s image service at these addresses, and Astro makes the web sizes when the site is built:

| File | Photographer | Where it’s used | Downloaded from |
|---|---|---|---|
| `green-couch.jpg` | [Evan Wise](https://unsplash.com/photos/a-living-room-with-a-green-couch-and-a-coffee-table-jZkFVycn3FQ) | Home hero | `https://images.unsplash.com/photo-1661796428215-04fc2830aae6?w=1600&q=80&fm=jpg` |
| `apartment.jpg` | [Patrick Perkins](https://unsplash.com/photos/gray-fabric-loveseat-near-brown-wooden-table-3wylDrjxH-E) | Home demo (sent to the consultant) | `https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=2000&q=80&fm=jpg` |
| `bedroom-mirror.jpg` | [Minh Pham](https://unsplash.com/photos/white-wooden-dresser-with-mirror-7pCFUybP_P8) | Home, sample pots | `https://images.unsplash.com/photo-1556020685-ae41abfc9365?w=1400&q=80&fm=jpg` |
| `swatches.jpg` | [Clay Banks](https://unsplash.com/photos/white-blue-red-and-yellow-concrete-building-T2KOfVwW3g0) | Home, brands | `https://images.unsplash.com/photo-1608556984704-fa578c96e6eb?w=1400&q=80&fm=jpg` |
| `leather-sofa.jpg` | [Michael Oxendine](https://unsplash.com/photos/living-room-with-brown-leather-sofa-GHCVUtBECuY) | Home, closing | `https://images.unsplash.com/photo-1589834390005-5d4fb9bf3d32?w=1600&q=80&fm=jpg` |
| `reading-corner.jpg` | [Kate Darmody](https://unsplash.com/photos/white-and-brown-table-lamp-on-brown-wooden-table-TDIdPmW2P9k) | Brands page | `https://images.unsplash.com/photo-1617201929478-8eedff7508f9?w=1400&q=80&fm=jpg` |

The owner also picked [Yevhenii Deshko’s living room](https://unsplash.com/photos/a-living-room-filled-with-furniture-and-a-large-window-TBJrxAvVx_M), but it’s an Unsplash+ photo, which needs a paid Unsplash+ licence, so it isn’t used.

When you add a photo: check it’s a real photograph and free (not Unsplash+), then add it to `src/lib/photos.ts` with alt text and the credit, and to this table.

## Payments and orders

The checkout flow is the same as Big Jo’s Beds:

- The cart is a cookie holding only ids and quantities, re-priced from the catalogue on every page.
- Checkout creates an order, and the customer is sent to PayFast with a signed form.
- PayFast’s ITN (`/api/payfast/itn`) marks the order paid only when every check passes: signature, source IP, merchant, amount, and server confirmation.
- Paid orders email the customer and the owner. The owner’s email gives a “deliver by” date 3 days out.

## Sample pots

- **Ordering:** every colour page has “Order a sample pot” (or, for Prominent Paints, which makes none, the smallest tin). The consultant’s results have a “Try them on your wall first” box that adds a pot of each suggested colour in one click (`add-samples` in `src/lib/cart-actions.ts`). Sample prices and which pot fits which colour come from `catalogue.json → samples`.
- **Guide:** `/samples` (in the main menu) explains how to order, what pots cost (from the catalogue) and how to test a colour. The cart and the order page link to it when there are sample pots, and the order confirmation email includes the testing steps (`copy.json → samples.testSteps`, one source for page and email).
- **Follow-up email:** once a day (07:00 UTC, `crons` in `vercel.json`), `/api/cron/sample-follow-ups` emails each customer whose sample order was paid 7 days ago (`business.json → sampleFollowUp.afterDays`: 3 days’ delivery plus 4 to test), once per order: how do the patches look, links to order each colour, and a nudge to give the consultant the room size. Orders older than 30 days are skipped. It needs `CRON_SECRET` (Vercel sends it to the job), Supabase with `supabase/migrations/0002_sample_follow_ups.sql` applied, and Resend. Code: `src/lib/follow-ups.ts`, `sampleFollowUp()` in `src/lib/email.ts`.

## Commerce modes

- `sandbox` (default): test shop with a banner, PayFast sandbox, `noindex`.
- `live`: real payments. The build fails until every launch input below is supplied.

## Launch inputs still needed

- [ ] `OPENAI_API_KEY` in Vercel (Production, type Sensitive). Without it the consultant runs in demo mode and there are no AI previews.
- [ ] The tinting merchant’s trade price list, interior and exterior (owner, 12 Oct 2026). It sets the selling prices in `src/data/catalogue.json` and supplies the exterior paints for outside painting, which waits on it. Brands the merchant can’t tint are switched off until another merchant covers them.
- [ ] Delivery fee in `src/config/business.json → delivery.feeCents` (0 for free), and where you deliver.
- [ ] Legal name, registration number, physical address and email in `src/config/business.json` (ECTA s43).
- [ ] Terms of sale, delivery and returns, and privacy notice as `src/content/policies/*.md`.
- [ ] PayFast live merchant ID, key and passphrase (Vercel Production, Sensitive).
- [ ] Supabase project with `supabase/migrations/0001_init.sql` and `0002_sample_follow_ups.sql` applied, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Then remove `ORDER_STORE=memory` from Vercel: the in-memory store loses orders between server instances.
- [ ] `CRON_SECRET` in Vercel (Production, Sensitive) for the daily sample follow-up email.
- [ ] Resend sending domain, `RESEND_API_KEY`, `EMAIL_FROM` and `OWNER_EMAIL`.
- [ ] Confirm the WhatsApp number (Johannes’s own number, carried over from Big Jo’s Beds).
- [ ] A domain, then `PUBLIC_SITE_URL`.

## Where things live

| Path | What it is |
|---|---|
| `src/data/catalogue.json` | Brands, paints (tins, prices, coverage), sample pots and the hand-picked colours |
| `src/data/colours/` | Each brand’s full colour range (name, code, hex, collection) |
| `src/lib/colour-science.ts`, `colour-search.ts` | Colour family, base and description from a hex; search, filters and closest matches for `/colours` |
| `src/content/demo.json`, `src/components/HomeDemo.astro` | The home-page demo: a real GPT-5.5 consultation on a real living-room photo, with a tinted-walls preview |
| `src/lib/photos.ts`, `src/assets/photos/` | The site’s photos and their credits (see Photos) |
| `src/content/copy.json` | Site copy (draft for owner review) |
| `src/config/business.json` | Business details and delivery (3 days; fee to be set) |
| `src/lib/ai.ts`, `rules.ts`, `consult.ts` | The colour consultant |
| `src/lib/preview.ts`, `src/scripts/preview.ts`, `src/pages/api/preview.ts` | AI previews of the customer’s room in each colour |
| `src/scripts/preview-share.ts` | “Send on WhatsApp”: the picture with colour and cost, and the share |
| `src/lib/estimate.ts` | Wall area, litres and tin mix |
| `src/lib/cart.ts`, `checkout.ts`, `payfast.ts`, `itn.ts`, `orders.ts` | Shop and payments |
| `public/logos/` | The Big Jo’s Paints logo (`npm run logos` makes the variants) |
| `tests/e2e/mock-openai.mjs` | Local stand-in for OpenAI used by the browser tests |
