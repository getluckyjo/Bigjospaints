# Big Jo’s Paints: notes for Claude

Read `README.md` first. This is the paint shop sister site of Big Jo’s Beds (github.com/getluckyjo/bigjosbeds), and it shares that site’s brand kit and payment code.

## Rules that matter here

- **Name and tagline:** **Big Jo’s Paints** (curly apostrophe, never "Joe’s"). The tagline “Big on colour. Easy on you.” is a draft.
- **Copy:** lives in `src/content/copy.json` and is a draft for owner review.
- **Owner’s brief (11 Oct 2026):**
  - an online reseller of South Africa’s top paint brands
  - an AI colour consultant driven by OpenAI GPT-5.5
  - photo + brief + room size gives 3 colours with the brand and the cost to paint
  - customers buy online and get the paint **delivered in 3 days** (`business.json → delivery.days`)
- **Colours and prices:** `src/data/catalogue.json` (prices, paints, sample pots, hand-picked colours) and `src/data/colours/<brand>.json` (each brand’s full range) are the only sources. Keep colour ids stable: they are in carts, orders and links. Only add a colour with the brand’s own published hex; don’t estimate one from a photo. Sample pots and prices come from research and are for owner review. The AI may only return catalogue ids (strict JSON schema enums), and the server re-checks them. Never let the AI set a quantity or a price; all maths is in `src/lib/estimate.ts`.
- **What not to invent:** prices, delivery fees or areas, return terms, warranties, reviews, certifications or contact details. Unknowns stay `null` in `business.json` and are hidden on the site.
- **Brand partnerships:** don’t claim any (no "authorised", no brand logos). Brand and colour names are the brands’ own.
- **Swatches:** hex values are screen approximations. Keep the “paint a test patch” guidance near colour choices.
- **Home-page demo:** `src/content/demo.json` is a real GPT-5.5 consultation, run on the live site on 11 Oct 2026; keep its AI text unedited. To change it, run a new consultation and copy the answer. The tinted-walls preview is a mock-up for that one photo, Patrick Perkins' living room (mask in `public/demo/walls.png`; a new photo needs a new mask), and the page says so.
- **Photos:** real photographs only, never renders or AI images. The owner chose the current set from Unsplash (11 Oct 2026); don't swap them without asking. They're free Unsplash photos (not Unsplash+, which needs a paid licence), credited next to each photo through `src/lib/photos.ts` and listed in README "Photos". Don't use the Big Jo’s Beds concept renders here.
- **PayFast:**
  - Never mark an order paid outside `processItn()` (`src/lib/itn.ts`).
  - `/api/payfast/itn` is the only route exempt from the origin check in `src/middleware.ts`.
  - Live credentials live only in Vercel Production. Never copy, print or commit them, or the OpenAI key.
- **Brand:**
  - Kit tokens are in `src/styles/tokens.css` and `brand.css`.
  - The logo master is `public/logos/big-jos-paints-primary.svg`; run `npm run logos` after changing it.
  - Icons come from `src/data/icons.json` (24 grid, 1.75 stroke, always with text).
  - Clay is the action colour.
- **Accessibility:** every page must pass axe (WCAG 2.2 AA) at 390 and 1440 px and have no horizontal overflow from 320 px (`npm run test:e2e`).

## Commands

`npm run dev` · `npm test` · `npm run test:e2e` · `npm run build`

Playwright is pinned to 1.56.1 to match the Chromium in Claude Code cloud sessions.

Astro is pinned to 7.3.5 and `@astrojs/vercel` to 11.0.11, the versions Big Jo’s Beds runs in production. With astro 7.3.8 and adapter 11.0.13 the server entry gained `import "rolldown"`, and every on-demand page crashed on Vercel with "Cannot find native binding" (11 Oct 2026). Before upgrading either one, build and check that `.vercel/output/functions/_render.func/.vercel/output/server/entry.mjs` doesn't import `rolldown`, then open an on-demand page (such as `/cart`) on a preview deployment.
