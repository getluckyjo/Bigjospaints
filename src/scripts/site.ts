/**
 * Progressive enhancement only: every page works without this script.
 * - Shows the cart count in the header (static pages can't read the cart cookie on the server).
 * - Forms: a busy state while submitting, and no double submits.
 */
import { initColourFilter } from './colours';
import { initConsultant } from './consultant';

function cartCount(): number {
  const raw = document.cookie.split('; ').find((c) => c.startsWith('bjp_cart='))?.slice('bjp_cart='.length);
  if (!raw) return 0;
  try {
    const base64 = decodeURIComponent(raw).replace(/-/g, '+').replace(/_/g, '/');
    const entries = JSON.parse(atob(base64));
    return Array.isArray(entries) ? entries.reduce((sum: number, e: unknown) => sum + (Array.isArray(e) ? Number(e[3]) || 0 : 0), 0) : 0;
  } catch {
    return 0;
  }
}

const count = cartCount();
for (const el of document.querySelectorAll<HTMLElement>('[data-bj-cart-count]')) el.textContent = count ? String(count) : '';
for (const el of document.querySelectorAll<HTMLElement>('[data-bj-cart-count-sr]')) {
  el.textContent = count ? `, ${count} ${count === 1 ? 'item' : 'items'}` : ', empty';
}

for (const form of document.querySelectorAll<HTMLFormElement>('form[data-bj-busy]')) {
  form.addEventListener('submit', (event) => {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) return;
    if (button.getAttribute('aria-busy') === 'true') {
      event.preventDefault();
      return;
    }
    button.setAttribute('aria-busy', 'true');
    if (button.dataset.busyLabel) button.textContent = button.dataset.busyLabel;
  });
}

window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[aria-busy="true"]')) {
    button.removeAttribute('aria-busy');
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
});

initConsultant();
initColourFilter();

document.querySelector<HTMLElement>('[data-bj-focus]')?.focus();
