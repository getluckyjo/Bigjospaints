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

test('colour browser filters by brand and family', async ({ page }) => {
  await page.goto('/colours');
  const all = await page.locator('.bj-colour-grid li:visible').count();
  await page.getByRole('button', { name: 'Dulux' }).click();
  await expect(page).toHaveURL(/brand=dulux/);
  const dulux = await page.locator('.bj-colour-grid li:visible').count();
  expect(dulux).toBeGreaterThan(0);
  expect(dulux).toBeLessThan(all);
  for (const tile of await page.locator('.bj-colour-grid li:visible').all()) await expect(tile).toHaveAttribute('data-brand', 'dulux');
  await page.getByRole('button', { name: 'Greens' }).click();
  for (const group of await page.locator('[data-family]:visible').all()) await expect(group).toHaveAttribute('data-family', 'green');
  await page.goto('/colours?brand=duram');
  await expect(page.getByRole('button', { name: 'Duram' })).toHaveAttribute('aria-pressed', 'true');
});

test('the mobile menu opens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await page.getByText('Menu').click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Brands' }).click();
  await expect(page).toHaveURL(/\/brands$/);
});
