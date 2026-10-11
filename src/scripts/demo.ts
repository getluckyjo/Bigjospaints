/**
 * Home-page demo: tint the walls of the example photo in a chosen paint colour.
 * The wall mask (public/demo/walls.png, white = wall) was made for this one photo (see demo.json). Each
 * wall pixel keeps its own light and shade: the paint colour is scaled by how bright that pixel is
 * compared with the brightest part of the wall, in linear light, then blended in by the mask.
 */
const toLinear = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const STEPS = 4096;
const toSrgb = new Uint8ClampedArray(STEPS + 1).map((_, i) => {
  const c = i / STEPS;
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
});

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });

function pixels(img: HTMLImageElement, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

export function initDemo() {
  const root = document.querySelector<HTMLElement>('[data-bj-demo]');
  const canvas = root?.querySelector<HTMLCanvasElement>('[data-bj-demo-canvas]');
  const picker = root?.querySelector<HTMLElement>('[data-bj-demo-picker]');
  if (!root || !canvas || !picker || !root.dataset.photo || !root.dataset.mask) return;
  const status = root.querySelector<HTMLElement>('[data-bj-demo-status]');

  let ready: Promise<(hex: string) => void> | null = null;
  const prepare = async () => {
    const [photo, mask] = await Promise.all([loadImage(root.dataset.photo!), loadImage(root.dataset.mask!)]);
    const width = photo.naturalWidth;
    const height = photo.naturalHeight;
    const src = pixels(photo, width, height);
    const alpha = pixels(mask, width, height);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const out = ctx.createImageData(width, height);

    // Linear luminance of each pixel, and the wall's "fully lit" level (its 92nd percentile).
    const lum = new Float32Array(width * height);
    const wall: number[] = [];
    for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
      lum[p] = 0.2126 * toLinear[src[i]] + 0.7152 * toLinear[src[i + 1]] + 0.0722 * toLinear[src[i + 2]];
      if (alpha[i] > 230 && p % 7 === 0) wall.push(lum[p]);
    }
    wall.sort((a, b) => a - b);
    const lit = wall[Math.floor(wall.length * 0.92)] || 1;

    return (hex: string) => {
      const paint = [1, 3, 5].map((k) => toLinear[Number.parseInt(hex.slice(k, k + 2), 16)]);
      const d = out.data;
      for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
        const a = alpha[i] / 255;
        const shade = Math.min(lum[p] / lit, 1.15);
        for (let c = 0; c < 3; c++) {
          const before = toLinear[src[i + c]];
          const after = Math.min(paint[c] * shade, 1);
          d[i + c] = toSrgb[Math.round((before + (after - before) * a) * STEPS)];
        }
        d[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
    };
  };

  const buttons = [...picker.querySelectorAll<HTMLButtonElement>('button[data-hex]')];
  const choose = async (button: HTMLButtonElement) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
    const hex = button.dataset.hex ?? '';
    if (!hex) {
      root.classList.remove('is-tinted');
      if (status) status.textContent = 'Showing the photo as sent.';
      return;
    }
    try {
      ready ??= prepare();
      (await ready)(hex);
      root.classList.add('is-tinted');
      if (status) status.textContent = `Showing the walls in ${button.textContent?.trim()}.`;
    } catch (error) {
      console.error('[demo]', error);
      picker.hidden = true;
    }
  };

  picker.hidden = false;
  for (const el of root.querySelectorAll<HTMLElement>('[data-bj-demo-js]')) el.hidden = false;
  picker.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-hex]');
    if (button) void choose(button);
  });
}
