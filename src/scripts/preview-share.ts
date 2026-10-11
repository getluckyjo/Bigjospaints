/**
 * "Send on WhatsApp" for the AI mock-ups. The shared picture carries everything itself (WhatsApp
 * sometimes drops the text that comes with a picture): the mock-up, its "AI mock-up" label, the
 * colour, brand and code, the paint and tins, the cost to paint, and the logo. On phones the share
 * sheet sends the picture and a message; elsewhere the picture is saved and WhatsApp opens with the
 * message, ready for the picture to be attached. Nothing is uploaded: the picture is made in the browser.
 */

/** One colour's details, from the results page (colour-consultant.astro, `shareFor`). */
export interface ShareInfo {
  hex: string;
  brand: string;
  code: string;
  /** The paint's name without the brand, e.g. "Double Velvet". */
  product: string;
  /** Formatted, e.g. "R1,798". */
  cost: string;
  /** e.g. "2 × 5 L". */
  tins: string;
  /** Site path of the colour's page. */
  url: string;
}

/** The wording, from copy.json (consultant.previewShare* and previewCard*). */
export interface ShareCopy {
  room: string;
  text: string;
  saved: string;
  label: string;
  cost: string;
  note: string;
}

const INK = '#292C27';
const MUTED = '#66635B';
const PAPER = '#FFFCF6';
const BONE = '#F4F0E7';
const LINE = '#D9D1C4';
const DISPLAY = '"DM Serif Display", Georgia, serif';
const BODY = '"DM Sans", Arial, sans-serif';
const LOGO = '/logos/big-jos-paints-primary.svg';
const LOGO_RATIO = 1306 / 440;

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m);

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Shrink the font until the text fits, down to `min` px; then cut it short with an ellipsis. */
function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, size: number, min: number, maxWidth: number): string {
  let px = size;
  ctx.font = font(px);
  while (ctx.measureText(text).width > maxWidth && px > min) ctx.font = font(--px);
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** The message that goes with the picture. */
export function shareText(copy: ShareCopy, name: string, info: ShareInfo, origin: string): string {
  return fill(copy.text, {
    room: copy.room,
    colour: name,
    brand: info.brand,
    product: `${info.brand} ${info.product}`,
    tins: info.tins,
    cost: info.cost,
    url: new URL(info.url, origin).href,
  });
}

/** The mock-up with a band underneath: colour, paint and cost, then the logo and the AI note. */
export async function drawCard(photo: HTMLImageElement, name: string, info: ShareInfo, copy: ShareCopy, site: string): Promise<Blob> {
  const W = photo.naturalWidth;
  const H = photo.naturalHeight;
  const u = W / 1200;
  const band = Math.round(250 * u);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H + band;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  await Promise.all([`400 48px ${DISPLAY}`, `400 22px ${BODY}`, `600 22px ${BODY}`].map((f) => document.fonts?.load(f).catch(() => [])));
  const logo = await loadImage(LOGO).catch(() => null);

  ctx.drawImage(photo, 0, 0, W, H);
  const pad = 24 * u;

  // "AI mock-up" on the photo, as on the page.
  ctx.font = `600 ${22 * u}px ${BODY}`;
  const pillH = 40 * u;
  const pillW = ctx.measureText(copy.label).width + 28 * u;
  ctx.fillStyle = BONE;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(pad, pad, pillW, pillH, pillH / 2);
  else ctx.rect(pad, pad, pillW, pillH);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(copy.label, pad + 14 * u, pad + pillH / 2);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, H, W, band);

  // The colour.
  const r = 40 * u;
  const cx = pad + r;
  const cy = H + 30 * u + r;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = info.hex;
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = LINE;
  ctx.stroke();

  // The cost, on the right.
  const right = W - pad;
  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = `400 ${52 * u}px ${DISPLAY}`;
  ctx.fillText(info.cost, right, H + 84 * u);
  const costWidth = ctx.measureText(info.cost).width;
  const costLabel = fill(copy.cost, { tins: info.tins });
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${22 * u}px ${BODY}`;
  ctx.fillText(costLabel, right, H + 120 * u);
  const rightWidth = Math.max(costWidth, ctx.measureText(costLabel).width);

  // The name, brand, code and paint.
  ctx.textAlign = 'left';
  const x = cx + r + 24 * u;
  const maxWidth = right - rightWidth - 32 * u - x;
  ctx.fillStyle = INK;
  ctx.fillText(fitText(ctx, name, (px) => `400 ${px}px ${DISPLAY}`, 48 * u, 28 * u, maxWidth), x, H + 82 * u);
  ctx.fillStyle = MUTED;
  const detail = [info.brand, info.code, info.product].filter(Boolean).join(' · ');
  ctx.fillText(fitText(ctx, detail, (px) => `400 ${px}px ${BODY}`, 22 * u, 16 * u, maxWidth), x, H + 120 * u);

  ctx.fillStyle = LINE;
  ctx.fillRect(pad, H + 150 * u, W - 2 * pad, Math.max(1, 1.5 * u));

  // The logo, and the note and site.
  const logoH = 60 * u;
  if (logo) ctx.drawImage(logo, pad, H + 170 * u, logoH * LOGO_RATIO, logoH);
  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${20 * u}px ${BODY}`;
  ctx.fillText(copy.note, right, H + 194 * u);
  ctx.fillText(site, right, H + 224 * u);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No image'))), 'image/jpeg', 0.9));
}

function saveAndOpen(file: File, text: string, onSaved: () => void) {
  const href = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = href;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  onSaved();
}

/**
 * Share the picture and message. The share sheet needs the click's user activation, so the picture
 * is made beforehand and this is called straight from the click.
 */
export function sharePicture(file: File, text: string, onSaved: () => void) {
  const data: ShareData = { files: [file], text };
  if (navigator.canShare?.(data)) {
    navigator.share(data).catch((error: DOMException) => {
      if (error.name !== 'AbortError') saveAndOpen(file, text, onSaved);
    });
    return;
  }
  saveAndOpen(file, text, onSaved);
}
