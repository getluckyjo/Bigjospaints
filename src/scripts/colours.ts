/**
 * Colour browser filters. Without JS every colour shows, grouped by family. With JS the brand and
 * family buttons filter the list, and ?brand= / ?family= in the address preselect them.
 */
export function initColourFilter() {
  const root = document.querySelector<HTMLElement>('[data-bj-colours]');
  if (!root) return;
  const filters = root.querySelector<HTMLElement>('[data-bj-filters]');
  if (filters) filters.hidden = false;
  const params = new URLSearchParams(window.location.search);
  const state = { brand: params.get('brand') ?? 'all', family: params.get('family') ?? 'all' };

  const apply = () => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      const [kind, value] = button.dataset.filter!.split(':');
      button.setAttribute('aria-pressed', String(state[kind as 'brand' | 'family'] === value));
    }
    let shown = 0;
    for (const group of root.querySelectorAll<HTMLElement>('[data-family]')) {
      let visible = 0;
      const familyOk = state.family === 'all' || group.dataset.family === state.family;
      for (const tile of group.querySelectorAll<HTMLElement>('[data-brand]')) {
        const ok = familyOk && (state.brand === 'all' || tile.dataset.brand === state.brand);
        tile.hidden = !ok;
        if (ok) visible++;
      }
      group.hidden = visible === 0;
      shown += visible;
    }
    const count = root.querySelector<HTMLElement>('[data-bj-count]');
    if (count) count.textContent = `${shown} colour${shown === 1 ? '' : 's'}`;
    const url = new URL(window.location.href);
    for (const key of ['brand', 'family'] as const) {
      if (state[key] === 'all') url.searchParams.delete(key);
      else url.searchParams.set(key, state[key]);
    }
    history.replaceState(null, '', url);
  };

  root.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-filter]');
    if (!button) return;
    const [kind, value] = button.dataset.filter!.split(':');
    state[kind as 'brand' | 'family'] = value;
    apply();
  });
  apply();
}
