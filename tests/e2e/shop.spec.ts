import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { checkoutSignature, type Pair } from '../../src/lib/payfast';
import { PAYFAST_SANDBOX } from '../../src/lib/config';
import catalogue from '../../src/data/catalogue.json' with { type: 'json' };

const PHOTO = path.join(import.meta.dirname, 'fixtures/room.jpg');
const MOCK = 'http://127.0.0.1:4599';

async function stubPayFast(page: Page) {
  const posts: Pair[][] = [];
  await page.route('https://sandbox.payfast.co.za/**', async (route) => {
    posts.push([...new URLSearchParams(route.request().postData() ?? '').entries()]);
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>PayFast stub</title><h1>PayFast stub</h1>' });
  });
  return posts;
}

async function fillConsultant(page: Page, brief = 'Calm and restful') {
  await page.goto('/colour-consultant');
  await page.setInputFiles('input[name="photo"]', PHOTO);
  await expect(page.getByText('Photo added')).toBeVisible();
  await page.getByLabel('Which room is it?').selectOption('Lounge');
  await page.getByLabel('Your brief').fill(brief);
  await page.getByText('I’ll measure it').click();
  await page.getByLabel('Length (m)').fill('5');
  await page.getByLabel('Width (m)').fill('4');
}

test.describe('AI colour consultant', () => {
  test('sends the photo, brief and room to gpt-5.5 and shows three priced colours', async ({ page, request }) => {
    await fillConsultant(page);
    await page.getByRole('button', { name: /Show my 3 colours/ }).click();
    const results = page.locator('#results');
    await expect(results).toBeVisible({ timeout: 30_000 });
    await expect(results).toBeFocused();
    await expect(results.getByText('Soft morning light from the left')).toBeVisible();
    await expect(page.locator('.bj-option-card')).toHaveCount(3);
    await expect(results.getByText('Your colour consultant isn’t switched on yet')).toHaveCount(0);

    // What OpenAI received.
    const last = await (await request.get(`${MOCK}/last`)).json();
    expect(last.headers.authorization).toBe('Bearer test-key');
    expect(last.body.model).toBe('gpt-5.5');
    expect(last.body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    const [text, image] = last.body.input[0].content;
    expect(text.text).toContain('Calm and restful');
    expect(text.text).toContain('5 × 4 m');
    expect(image.type).toBe('input_image');
    expect(image.image_url).toMatch(/^data:image\/jpeg;base64,/);

    // The mock picks the first colour of three brands; check the first card's maths.
    const first = catalogue.colours[0];
    const card = page.locator('.bj-option-card').first();
    await expect(card.getByRole('heading')).toHaveText(first.name);
    await expect(card.getByText('Mock reason for')).toBeVisible();
    // 2 × (5 + 4) × 2.6 = 46.8 m², less a door (1.9) and a window (1.5) = 43.4 m²
    await expect(card.locator('.bj-need')).toContainText('43.4 m²');
    await expect(card.locator('.bj-price-big strong')).toHaveText(/^R[\d,]+(\.\d\d)?$/);
  });

  test('paints AI mock-ups of the customer’s own room in each colour', async ({ page, request }) => {
    await fillConsultant(page, 'Fresh and leafy');
    await page.getByRole('button', { name: /Show my 3 colours/ }).click();
    const previews = page.locator('[data-bj-previews]');
    await expect(previews).toBeVisible({ timeout: 30_000 });
    await expect(previews.getByRole('heading', { name: 'See it in your room' })).toBeVisible();
    await expect(previews.getByText('These are AI mock-ups made from your photo.')).toBeVisible();
    const picker = previews.getByRole('group', { name: 'Show your room in' });
    const colours = picker.locator('button[data-name]');
    await expect(colours).toHaveCount(3);
    for (const button of await colours.all()) await expect(button).toBeEnabled({ timeout: 30_000 });

    // The first finished mock-up shows by itself, labelled as AI.
    const img = previews.locator('[data-bj-preview-img]');
    const label = previews.locator('[data-bj-preview-label]');
    await expect(label).toHaveText(/^AI mock-up: /);
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect(img).toHaveAttribute('alt', /^AI mock-up of your room with the walls painted /);

    const second = colours.nth(1);
    const name = (await second.getAttribute('data-name'))!;
    await second.click();
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(label).toHaveText(`AI mock-up: ${name}`);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([96, 64]); // the mock's image
    await picker.getByRole('button', { name: 'Your photo', exact: true }).click();
    await expect(img).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(label).toHaveText('Your photo');
    // Only a mock-up can be sent on WhatsApp.
    await expect(previews.getByRole('button', { name: 'Send on WhatsApp' })).toBeDisabled();

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `overflow at ${width}px`).toBe(true);
    }
    const axe = await new AxeBuilder({ page }).include('#results').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

    // What the image model received: the photo, at its own shape, and a prompt built from the catalogue.
    const edit = await (await request.get(`${MOCK}/last-edit`)).json();
    expect(edit.authorization).toBe('Bearer test-key');
    expect(edit.model).toBe('gpt-image-2.5-sunburst');
    expect(edit.quality).toBe('medium');
    expect(edit.hasImage).toBe(true);
    expect(edit.size).toMatch(/^\d+x\d+$/);
    expect(edit.size.split('x').every((n: string) => Number(n) % 16 === 0)).toBe(true);
    expect(edit.prompt).toMatch(/^Repaint the walls in this photo of a room in the paint colour /);
    expect(edit.prompt).toContain('Also tidy the room');
    expect(edit.prompt).not.toContain('Fresh and leafy');
  });

  test('sends a mock-up on WhatsApp with its colour and cost', async ({ page, context }) => {
    // A phone's share sheet: record what would be shared. __canShare = false acts like a computer without one.
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: unknown[]; __canShare?: boolean };
      w.__shared = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data: ShareData) => !!data.files?.length && w.__canShare !== false });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: ShareData) => {
          const file = data.files![0];
          const bitmap = await createImageBitmap(file);
          w.__shared.push({ name: file.name, type: file.type, size: file.size, width: bitmap.width, height: bitmap.height, text: data.text });
        },
      });
    });
    await context.route('https://wa.me/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>WhatsApp stub</title>' }));
    await fillConsultant(page, 'Warm and cosy');
    await page.getByRole('button', { name: /Show my 3 colours/ }).click();
    const previews = page.locator('[data-bj-previews]');
    const share = previews.getByRole('button', { name: 'Send on WhatsApp' });
    await expect(share).toBeEnabled({ timeout: 30_000 });
    const shown = previews.locator('button[data-name][aria-pressed="true"]');
    const id = (await shown.getAttribute('data-colour'))!;
    const name = (await shown.getAttribute('data-name'))!;
    const card = page.locator('.bj-option-card', { has: page.getByRole('heading', { name, exact: true }) });
    const cost = (await card.locator('.bj-price-big strong').textContent())!;

    await share.click();
    const shared = () => page.evaluate(() => (window as unknown as { __shared: Record<string, unknown>[] }).__shared);
    await expect.poll(async () => (await shared()).length).toBe(1);
    const [sent] = await shared();
    // The mock's 96 × 64 image with the colour-and-cost band (250 px at 1200 px wide) underneath.
    expect(sent).toMatchObject({ name: `big-jos-paints-${id}.jpg`, type: 'image/jpeg', width: 96, height: 84 });
    expect(sent.text).toContain(`Here’s our lounge in ${name}`);
    expect(sent.text).toContain('as an AI mock-up');
    expect(sent.text).toContain(cost);
    expect(sent.text).toContain(`http://127.0.0.1:4522/colours/${id}`);

    // Without a share sheet: the picture is saved and WhatsApp opens with the message.
    await page.evaluate(() => ((window as unknown as { __canShare: boolean }).__canShare = false));
    const [download, popup] = await Promise.all([page.waitForEvent('download'), context.waitForEvent('page'), share.click()]);
    expect(download.suggestedFilename()).toBe(`big-jos-paints-${id}.jpg`);
    expect(decodeURIComponent(popup.url())).toContain(`https://wa.me/?text=Here’s our lounge in ${name}`);
    await expect(previews.getByRole('status')).toHaveText('We saved the picture to your device. Attach it in WhatsApp to send it with the message.');
  });

  test('falls back to brief-based colours, and says so, when the AI fails', async ({ page }) => {
    await fillConsultant(page, 'trigger-error please');
    await page.getByRole('button', { name: /Show my 3 colours/ }).click();
    await expect(page.locator('#results')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Your colour consultant couldn’t look at your photo just now')).toBeVisible();
    await expect(page.locator('.bj-option-card')).toHaveCount(3);
  });

  test('explains a missing room measurement', async ({ page }) => {
    await page.goto('/colour-consultant');
    await page.getByText('I’ll measure it').click();
    await page.getByRole('button', { name: /Show my 3 colours/ }).click();
    await expect(page.getByRole('alert')).toContainText('Enter a length between 1 and 20 m.');
    await expect(page.getByLabel('Length (m)')).toHaveAttribute('aria-invalid', 'true');
  });

  test('works without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/colour-consultant');
    await page.setInputFiles('input[name="photo"]', PHOTO);
    await page.getByLabel('Your brief').fill('Warm and cosy');
    await page.getByRole('button', { name: /Show my 3 colours/ }).click();
    await expect(page.locator('.bj-option-card')).toHaveCount(3);
    // The AI mock-ups need JavaScript, so their panel stays hidden.
    await expect(page.locator('[data-bj-previews]')).toBeHidden();
    await page.locator('.bj-option-card').first().getByRole('button', { name: /Add .* to cart/ }).click();
    await expect(page).toHaveURL(/\/cart\?added=/);
    await expect(page.locator('.bj-cart-line').first()).toBeVisible();
    await context.close();
  });
});

test('consultant → cart → checkout → signed PayFast hand-off → order and cancel pages', async ({ page }) => {
  const posts = await stubPayFast(page);
  await fillConsultant(page);
  await page.getByRole('button', { name: /Show my 3 colours/ }).click();
  const card = page.locator('.bj-option-card').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const cost = (await card.locator('.bj-price-big strong').textContent())!;
  await card.getByRole('button', { name: /Add .* to cart/ }).click();

  await expect(page).toHaveURL(/\/cart\?added=/);
  await expect(page.getByRole('status')).toContainText('Added to your cart');
  await expect(page.locator('.bj-totals__total dd')).toHaveText(cost);
  await expect(page.locator('[data-bj-cart-count]')).not.toHaveText('');

  await page.getByRole('link', { name: 'Check out' }).click();
  await page.getByLabel('First name').fill('Lerato');
  await page.getByLabel('Last name').fill("O'Neil");
  await page.getByLabel('Email address').fill('lerato@example.com');
  await page.getByLabel('Mobile number').fill('082 123 4567');
  await page.getByLabel('Street address').fill('12 Jacaranda Street');
  await page.getByLabel('Suburb').fill('Parkhurst');
  await page.getByLabel('Town or city').fill('Johannesburg');
  await page.getByLabel('Province').selectOption('Gauteng');
  await page.getByLabel('Postal code').fill('2193');
  await page.getByLabel(/test order/).check();
  await page.getByRole('button', { name: `Pay ${cost} with PayFast` }).click();
  await expect(page.getByRole('heading', { name: 'PayFast stub' })).toBeVisible();

  const fields = posts[0];
  const data = Object.fromEntries(fields);
  expect(`R${Number(data.amount).toLocaleString('en-US', { minimumFractionDigits: data.amount.endsWith('.00') ? 0 : 2 })}`).toBe(cost);
  expect(data.merchant_id).toBe(PAYFAST_SANDBOX.merchantId);
  expect(data.m_payment_id).toMatch(/^BJP-\d{6}-[A-Z2-9]{4}$/);
  expect(data.name_last).toBe('O’Neil');
  expect(data.signature).toBe(checkoutSignature(fields.filter(([k]) => k !== 'signature'), PAYFAST_SANDBOX.passphrase));

  await page.goto(data.return_url);
  await expect(page.getByRole('heading', { name: 'We’re confirming your payment.' })).toBeVisible();
  await expect(page.getByText(data.m_payment_id)).toBeVisible();
  await page.goto(data.return_url.replace(/t=[^&]+/, 't=wrong'));
  await expect(page.getByRole('heading', { name: 'We couldn’t find that order.' })).toBeVisible();
  await page.goto(data.cancel_url);
  await expect(page.getByRole('heading', { name: 'Your payment didn’t go through.' })).toBeVisible();
});

test('buying from a colour page, then changing and removing the line', async ({ page }) => {
  const colour = catalogue.colours.find((c) => c.brand === 'plascon')!;
  await page.goto(`/colours/${colour.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(colour.name);
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page).toHaveURL(/\/cart\?added=2/);
  const line = page.locator('.bj-cart-line');
  await expect(line).toHaveCount(1);
  await line.getByLabel(/Quantity of/).fill('3');
  await line.getByRole('button', { name: 'Update' }).click();
  await expect(page.locator('.bj-cart-line').getByLabel(/Quantity of/)).toHaveValue('3');
  await page.locator('.bj-cart-line').getByRole('button', { name: /Remove/ }).click();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
});

test('ordering a sample pot, or a 1 L tin where the brand makes no pots', async ({ page }) => {
  await page.goto('/colours/plascon-desert-spring');
  await page.getByRole('button', { name: /Order a sample pot · R45/ }).click();
  await expect(page).toHaveURL(/\/cart\?added=1/);
  const line = page.locator('.bj-cart-line');
  await expect(line).toContainText('Plascon Perfect Colour Matt tester (matt), 250 ml sample pot, R45 each');
  await expect(page.locator('.bj-totals')).toContainText('1 sample pot');
  await page.goto('/colours/prominent-river-clay');
  await expect(page.getByText('Prominent Paints doesn’t make sample pots', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Add a 1 L tin to test/ }).click();
  await expect(page.locator('.bj-cart-line')).toHaveCount(2);
  await expect(page.locator('.bj-totals')).toContainText('Paint (1 L) and 1 sample pot');
  await page.goto('/checkout');
  await expect(page.locator('.bj-summary')).toContainText('1 × 250 ml Desert Spring');
  await expect(page.locator('.bj-summary')).toContainText('Paint and samples');
});

test.describe('request security', () => {
  test('cross-site form posts are refused', async ({ request }) => {
    const response = await request.post('/cart', { form: { action: 'add' }, headers: { origin: 'https://evil.example' } });
    expect(response.status()).toBe(403);
  });

  test('payment notifications need a valid PayFast signature', async ({ request }) => {
    const response = await request.post('/api/payfast/itn', {
      data: 'm_payment_id=BJP-261011-AAAA&payment_status=COMPLETE&signature=bad',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.status()).toBe(400);
  });
});
