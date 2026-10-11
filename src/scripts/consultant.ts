/**
 * Colour consultant enhancements. Without JS the form posts normally (photos up to 4 MB).
 * With JS: photo preview and drag-and-drop, brief idea chips, the photo is shrunk on the phone
 * before upload (phone photos are often 5–10 MB), and results load in place with a waiting state.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.82;

/** Shrink a photo to at most 1600 px on its long edge, as JPEG. Falls back to the original. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    return blob ?? file;
  } catch {
    return file;
  }
}

function setupPhoto(form: HTMLFormElement) {
  const drop = form.querySelector<HTMLElement>('[data-bj-drop]');
  const input = form.querySelector<HTMLInputElement>('input[type="file"][name="photo"]');
  const preview = form.querySelector<HTMLImageElement>('[data-bj-preview]');
  if (!drop || !input || !preview) return;

  const show = () => {
    const file = input.files?.[0];
    if (!file) {
      drop.classList.remove('has-photo');
      return;
    }
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    drop.classList.add('has-photo');
  };
  input.addEventListener('change', show);
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragging');
    if (e.dataTransfer?.files.length) {
      input.files = e.dataTransfer.files;
      show();
    }
  });
  show();
}

function setupChips(form: HTMLFormElement) {
  const chips = form.querySelector<HTMLElement>('[data-bj-chips]');
  const brief = form.querySelector<HTMLTextAreaElement>('textarea[name="brief"]');
  if (!chips || !brief) return;
  chips.hidden = false;
  const sync = () => {
    const text = brief.value.toLowerCase();
    for (const chip of chips.querySelectorAll<HTMLButtonElement>('[data-idea]')) {
      chip.setAttribute('aria-pressed', String(text.includes(chip.dataset.idea!.toLowerCase())));
    }
  };
  chips.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-idea]');
    if (!chip) return;
    const idea = chip.dataset.idea!;
    const parts = brief.value.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    const i = parts.findIndex((p) => p.toLowerCase() === idea.toLowerCase());
    if (i >= 0) parts.splice(i, 1);
    else parts.push(idea);
    brief.value = parts.join(', ');
    sync();
  });
  brief.addEventListener('input', sync);
  sync();
}

function setupSubmit(form: HTMLFormElement, root: HTMLElement) {
  const steps: string[] = JSON.parse(form.dataset.steps ?? '[]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const file = form.querySelector<HTMLInputElement>('input[name="photo"]')?.files?.[0];
    if (file) data.set('photo', await shrinkPhoto(file), 'room.jpg');

    root.classList.add('is-thinking');
    const thinking = root.querySelector<HTMLElement>('[data-bj-thinking]');
    thinking?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const stepEl = root.querySelector<HTMLElement>('[data-bj-thinking-step]');
    let step = 0;
    const timer = window.setInterval(() => {
      step = Math.min(step + 1, steps.length - 1);
      if (stepEl && steps[step]) stepEl.textContent = steps[step];
    }, 5000);

    try {
      const res = await fetch(form.action, { method: 'POST', body: data, headers: { accept: 'text/html' } });
      const html = await res.text();
      const next = new DOMParser().parseFromString(html, 'text/html').querySelector<HTMLElement>('[data-bj-consult]');
      if (!next) throw new Error('No consultant section in the response');
      root.replaceWith(next);
      initConsultant();
      const focus = next.querySelector<HTMLElement>('[data-bj-focus]');
      focus?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      focus?.focus({ preventScroll: true });
    } catch {
      root.classList.remove('is-thinking');
      const alert = document.createElement('div');
      alert.className = 'bj-alert';
      alert.setAttribute('role', 'alert');
      alert.innerHTML = '<span></span><p>We couldn’t reach our colour consultant. Check your connection and try again.</p>';
      form.prepend(alert);
    } finally {
      window.clearInterval(timer);
    }
  });
}

export function initConsultant() {
  const root = document.querySelector<HTMLElement>('[data-bj-consult]');
  const form = root?.querySelector<HTMLFormElement>('[data-bj-consult-form]');
  if (!root || !form || form.dataset.ready) return;
  form.dataset.ready = '1';
  setupPhoto(form);
  setupChips(form);
  setupSubmit(form, root);
}
