/**
 * PayFast custom integration (redirect + ITN).
 * Reference: https://developers.payfast.co.za/docs (custom integration, steps 1–4).
 *
 * Signatures follow PayFast's PHP reference: PHP urlencode() semantics (uppercase
 * percent-escapes, spaces as "+", and !'()*~ escaped too), then MD5.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import type { PayFastConfig } from './config';

export type Pair = [string, string];

/** PHP urlencode(): like encodeURIComponent, but also escapes !'()*~ and uses + for spaces. */
export function phpUrlencode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

function md5(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a.toLowerCase());
  const right = Buffer.from(b.toLowerCase());
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Free text sent to PayFast: collapse whitespace, drop control characters, swap straight
 * apostrophes for ’ and drop !()*~ so no character's encoding is implementation-dependent.
 */
export function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/'/g, '’')
    .replace(/[!()*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** South African mobile number in PayFast's 10-digit format, or null if it isn't one. */
export function payfastCellNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/[^\d+]/g, '');
  if (digits.startsWith('+27')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('27') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return /^0[6-8]\d{8}$/.test(digits) ? digits : null;
}

/** Signature for the checkout form: non-blank fields in posted order, then the passphrase. */
export function checkoutSignature(fields: Pair[], passphrase?: string | null): string {
  const parts = fields
    .filter(([, value]) => value.trim() !== '')
    .map(([key, value]) => `${key}=${phpUrlencode(value.trim())}`);
  if (passphrase) parts.push(`passphrase=${phpUrlencode(passphrase.trim())}`);
  return md5(parts.join('&'));
}

export interface CheckoutRequest {
  reference: string;
  amount: string; // "24999.00"
  itemName: string;
  itemDescription: string;
  firstName: string;
  lastName: string;
  email: string;
  cellNumber?: string | null;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  customStr1?: string;
  customStr2?: string;
  customInt1?: number;
}

/** Ordered, signed form fields for POSTing to PayFast's process URL. */
export function buildCheckoutForm(req: CheckoutRequest, cfg: PayFastConfig): { action: string; fields: Pair[] } {
  // Order matters: it must match PayFast's documented attribute order.
  const ordered: Pair[] = [
    ['merchant_id', cfg.merchantId],
    ['merchant_key', cfg.merchantKey],
    ['return_url', req.returnUrl],
    ['cancel_url', req.cancelUrl],
    ['notify_url', req.notifyUrl],
    ['name_first', cleanText(req.firstName, 100)],
    ['name_last', cleanText(req.lastName, 100)],
    ['email_address', req.email.trim().slice(0, 100)],
    ['cell_number', payfastCellNumber(req.cellNumber) ?? ''],
    ['m_payment_id', req.reference],
    ['amount', req.amount],
    ['item_name', cleanText(req.itemName, 100)],
    ['item_description', cleanText(req.itemDescription, 255)],
    ['custom_int1', req.customInt1 === undefined ? '' : String(req.customInt1)],
    ['custom_str1', cleanText(req.customStr1 ?? '', 255)],
    ['custom_str2', cleanText(req.customStr2 ?? '', 255)],
  ];
  // Only non-blank fields are posted, so the posted set is exactly the signed set.
  const fields = ordered.filter(([, value]) => value.trim() !== '').map(([k, v]) => [k, v.trim()] as Pair);
  fields.push(['signature', checkoutSignature(fields, cfg.passphrase)]);
  return { action: `https://${cfg.host}/eng/process`, fields };
}

/** Parse an ITN body, keeping PayFast's field order. */
export function parseItnBody(body: string): Pair[] {
  return [...new URLSearchParams(body).entries()];
}

/** The ITN parameter string: every field before "signature", in received order (blanks included). */
export function itnParamString(pairs: Pair[]): string {
  const parts: string[] = [];
  for (const [key, value] of pairs) {
    if (key === 'signature') break;
    parts.push(`${key}=${phpUrlencode(value)}`);
  }
  return parts.join('&');
}

export function verifyItnSignature(pairs: Pair[], passphrase?: string | null): boolean {
  const signature = pairs.find(([key]) => key === 'signature')?.[1];
  if (!signature) return false;
  let base = itnParamString(pairs);
  if (passphrase) base += `&passphrase=${phpUrlencode(passphrase.trim())}`;
  return safeEqualHex(md5(base), signature);
}

/** Hosts PayFast lists as ITN sources, plus their published address ranges. */
export const PAYFAST_ITN_HOSTS = [
  'www.payfast.co.za',
  'sandbox.payfast.co.za',
  'w1w.payfast.co.za',
  'w2w.payfast.co.za',
] as const;

export const PAYFAST_ITN_RANGES = [
  '197.97.145.144/28',
  '41.74.179.192/27',
  '102.216.36.0/28',
  '102.216.36.128/28',
  '144.126.193.139/32',
] as const;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n;
}

export function ipInRange(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  const bits = Number(bitsText ?? 32);
  const address = ipv4ToInt(ip);
  const network = ipv4ToInt(base);
  if (address === null || network === null) return false;
  const size = 2 ** (32 - bits);
  const start = Math.floor(network / size) * size;
  return address >= start && address < start + size;
}

/** Strip an IPv4-mapped IPv6 prefix and any port. */
export function normaliseIp(ip: string): string {
  let value = ip.trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) value = value.split(':')[0];
  return value;
}

export type Resolver = (host: string) => Promise<string[]>;

let resolved: { at: number; ips: Set<string> } | null = null;

export async function isPayFastIp(ip: string, resolver: Resolver = resolve4, nowMs = Date.now()): Promise<boolean> {
  const address = normaliseIp(ip);
  if (PAYFAST_ITN_RANGES.some((cidr) => ipInRange(address, cidr))) return true;
  if (!resolved || nowMs - resolved.at > 5 * 60_000) {
    const lookup = (host: string) =>
      Promise.race([
        resolver(host),
        new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 3_000).unref?.()),
      ]).catch(() => [] as string[]);
    const lists = await Promise.all(PAYFAST_ITN_HOSTS.map(lookup));
    resolved = { at: nowMs, ips: new Set(lists.flat()) };
  }
  return resolved.ips.has(address);
}

/** Test hook: forget cached DNS results. */
export function resetPayFastIpCache(): void {
  resolved = null;
}

export type Confirmation = 'valid' | 'invalid' | 'error';

/** Step 4: ask PayFast to confirm the notification data is genuine. */
export async function confirmWithPayFast(
  paramString: string,
  host: PayFastConfig['host'],
  fetchImpl: typeof fetch = fetch,
): Promise<Confirmation> {
  try {
    const response = await fetchImpl(`https://${host}/eng/query/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: paramString,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return 'error';
    return (await response.text()).trim() === 'VALID' ? 'valid' : 'invalid';
  } catch {
    return 'error';
  }
}
