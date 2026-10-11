import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const COLOUR = 'dulux-clinic-white';
const PAGES = ['/', '/colour-consultant', '/colours', `/colours/${COLOUR}`, '/brands', '/help', '/cart', '/checkout'];
const WIDTHS = [320, 390, 768, 1440];

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('every page', () => {
  for (const path of PAGES) {
    test(`${path} fits 320–1440px, has one h1, loads cleanly and passes axe`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        expect(await noOverflow(page), `overflow at ${width}px`).toBe(true);
      }
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByText('Test shop: checkout uses the PayFast sandbox')).toBeVisible();
      expect(await page.locator('img:not([alt])').count()).toBe(0);
      expect(errors).toEqual([]);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      }
    });
  }

  test('only local assets load (no third-party requests)', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => !r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && external.push(r.url()));
    for (const path of PAGES) await page.goto(path);
    expect(external).toEqual([]);
  });
});

test('home leads to the consultant and says delivery is 3 days', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your colour. Know the cost.');
  await expect(page.getByText('Delivered in 3 days').first()).toBeVisible();
  await page.getByRole('link', { name: 'Start with a photo' }).first().click();
  await expect(page).toHaveURL(/\/colour-consultant$/);
});

test('colour browser searches and filters the full range without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/colours');
  await expect(page.getByRole('status')).toContainText(/^[\d,]+ colours, page 1 of \d+/);
  await expect(page.locator('.bj-colour-grid li')).toHaveCount(60);
  await page.getByLabel('Brand').selectOption('duram');
  await page.getByLabel('Colour', { exact: true }).selectOption('green');
  await page.getByRole('button', { name: 'Show colours' }).click();
  await expect(page).toHaveURL(/brand=duram/);
  await expect(page).toHaveURL(/family=green/);
  for (const tile of await page.locator('.bj-colour-tile__text span').all()) await expect(tile).toContainText('Duram');
  await page.goto('/colours?q=egret');
  await expect(page.getByRole('link', { name: /Egret/ }).first()).toBeVisible();
  await page.goto('/colours?q=zzzz-no-such-colour');
  await expect(page.getByText('No colours match those filters.')).toBeVisible();
  await page.goto('/colours?family=purple');
  await expect(page.getByRole('link', { name: 'Purples and lilacs' })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(/family=purple&page=2|page=2&family=purple/);
  await context.close();
});

test('home demo shows a real consultation and tints the walls', async ({ page }) => {
  await page.goto('/');
  const demo = page.locator('[data-bj-demo]');
  await expect(demo.getByRole('heading', { name: 'One photo in. Three colours out.' })).toBeVisible();
  await expect(demo.locator('.bj-demo__options li')).toHaveCount(3);
  await expect(demo.getByText(/R\d/).first()).toBeVisible();
  const sahara = demo.getByRole('button', { name: 'Sahara Drive' });
  await sahara.click();
  await expect(sahara).toHaveAttribute('aria-pressed', 'true');
  await expect(demo).toHaveClass(/is-tinted/);
  await expect(demo.locator('[data-bj-demo-status]')).toHaveText('Showing the walls in Sahara Drive.');
  // The walls take on the colour and the sofa doesn't: compare the canvas with the photo it was made from.
  await demo.getByRole('button', { name: 'Tree Fern' }).click();
  await expect(demo.locator('[data-bj-demo-status]')).toHaveText('Showing the walls in Tree Fern.');
  const px = await demo.evaluate(async (root: HTMLElement) => {
    const canvas = root.querySelector('canvas')!;
    const photo = new Image();
    photo.src = root.dataset.photo!;
    await photo.decode();
    const plain = document.createElement('canvas');
    plain.width = canvas.width;
    plain.height = canvas.height;
    plain.getContext('2d')!.drawImage(photo, 0, 0);
    const at = (c: HTMLCanvasElement, x: number, y: number) =>
      Array.from(c.getContext('2d')!.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data);
    return { wall: at(canvas, 0.42, 0.3), wallBefore: at(plain, 0.42, 0.3), sofa: at(canvas, 0.45, 0.6), sofaBefore: at(plain, 0.45, 0.6) };
  });
  expect(px.wallBefore[0]).toBeGreaterThanOrEqual(px.wallBefore[1]); // a warm white wall in the photo…
  expect(px.wall[1]).toBeGreaterThan(px.wall[0]); // …turns sage green
  expect(px.wallBefore[0] - px.wall[0]).toBeGreaterThan(10);
  for (let c = 0; c < 3; c++) expect(Math.abs(px.sofa[c] - px.sofaBefore[c])).toBeLessThanOrEqual(2);
  await demo.getByRole('button', { name: 'Photo as sent' }).click();
  await expect(demo).not.toHaveClass(/is-tinted/);
  await demo.getByRole('link', { name: 'Try it with your room' }).click();
  await expect(page).toHaveURL(/\/colour-consultant$/);
});

test('home photos are credited to their Unsplash photographers', async ({ page }) => {
  await page.goto('/');
  const credits = page.locator('main').getByRole('link', { name: /on Unsplash$/ });
  await expect(credits).toHaveCount(5);
  for (const link of await credits.all()) await expect(link).toHaveAttribute('href', /^https:\/\/unsplash\.com\/photos\//);
  await expect(page.getByText(/from R\d+, paint a test patch/)).toBeVisible();
});

test('the mobile menu opens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await page.getByText('Menu').click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Brands' }).click();
  await expect(page).toHaveURL(/\/brands$/);
});
