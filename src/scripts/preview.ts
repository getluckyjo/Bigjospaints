/**
 * "See it in your room": once the results show, ask /api/preview to repaint the customer's photo in
 * each of the three colours (in parallel; each takes up to a minute), then let them switch between
 * their photo and the AI mock-ups. Needs JavaScript; without it the results show swatches only.
 */
export function initPreviews() {
  const root = document.querySelector<HTMLElement>('[data-bj-previews]');
  const img = root?.querySelector<HTMLImageElement>('[data-bj-preview-img]');
  // The photo is in the page once, beside the room read; the panel borrows it.
  const sent = document.querySelector<HTMLImageElement>('.bj-results__photo');
  if (!root || !img || !sent?.src || root.dataset.ready || !root.dataset.token) return;
  root.dataset.ready = '1';
  img.src = sent.src;
  const label = root.querySelector<HTMLElement>('[data-bj-preview-label]');
  const status = root.querySelector<HTMLElement>('[data-bj-preview-status]');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-colour]')];
  const original = { src: img.src, alt: img.alt, label: label?.textContent ?? '' };
  const urls = new Map<string, string>();
  let chosen = false;

  const show = (button: HTMLButtonElement) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
    const id = button.dataset.colour ?? '';
    const name = button.dataset.name ?? '';
    if (!id || !urls.has(id)) {
      img.src = original.src;
      img.alt = original.alt;
      if (label) label.textContent = original.label;
      if (status) status.textContent = 'Showing your photo as you sent it.';
      return;
    }
    img.src = urls.get(id)!;
    img.alt = `AI mock-up of your room with the walls painted ${name}`;
    if (label) label.textContent = `AI mock-up: ${name}`;
    if (status) status.textContent = `Showing your room in ${name}.`;
  };

  root.querySelector('[data-bj-preview-picker]')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-colour]');
    if (!button || button.disabled) return;
    chosen = true;
    show(button);
  });

  root.hidden = false;
  // The panel shows the photo large, so the small copy beside the room read can go.
  document.querySelector('.bj-results__intro')?.classList.add('has-preview');

  void (async () => {
    const photo = await (await fetch(original.src)).blob();
    await img.decode().catch(() => {});
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    // Keep the frame the photo's shape, so switching to a mock-up (rounded to 16 px) doesn't jump.
    if (width && height) img.style.aspectRatio = `${width} / ${height}`;
    await Promise.all(
      buttons
        .filter((b) => b.dataset.colour)
        .map(async (button) => {
          const id = button.dataset.colour!;
          const state = button.querySelector<HTMLElement>('[data-bj-preview-state]');
          try {
            const body = new FormData();
            body.set('token', root.dataset.token!);
            body.set('colour', id);
            body.set('photo', photo, 'room.jpg');
            body.set('width', String(width));
            body.set('height', String(height));
            const res = await fetch('/api/preview', { method: 'POST', body });
            if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
            urls.set(id, URL.createObjectURL(await res.blob()));
            button.disabled = false;
            if (state) state.textContent = '';
            // Show the first finished preview, unless the customer has already picked one.
            if (!chosen) {
              chosen = true;
              show(button);
            }
          } catch (error) {
            console.warn('[preview]', (error as Error).message);
            button.classList.add('is-failed');
            if (state) state.textContent = root.dataset.failed ?? '';
          }
        }),
    );
    if (urls.size === 0) root.querySelector<HTMLElement>('[data-bj-preview-none]')?.removeAttribute('hidden');
  })();
}
