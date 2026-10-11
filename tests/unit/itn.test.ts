import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processItn, type ItnDeps } from '../../src/lib/itn';
import { MemoryStore, type NewOrder, type Order } from '../../src/lib/orders';
import { phpUrlencode } from '../../src/lib/payfast';
import { PAYFAST_SANDBOX } from '../../src/lib/config';
import { createHash } from 'node:crypto';

const PAYFAST_IP = '197.97.145.150';

const newOrder: NewOrder = {
  lines: [
    {
      productId: 'plascon-double-velvet',
      productName: 'Double Velvet',
      brandName: 'Plascon',
      colourId: 'plascon-ray-of-light',
      colourName: 'Ray Of Light',
      colourCode: 'O7-A2-3',
      sizeLitres: 5,
      quantity: 2,
      unitPriceCents: 89900,
    },
  ],
  subtotalCents: 179800,
  deliveryFeeCents: null,
  totalCents: 179800,
  firstName: 'Thabo',
  lastName: 'Mokoena',
  email: 'thabo@example.com',
  phone: '0821234567',
  street: '40 Strubens Road',
  suburb: 'Mowbray',
  city: 'Cape Town',
  province: 'Western Cape',
  postalCode: '7700',
  notes: null,
  commerceMode: 'sandbox',
};

/** Sign like PayFast does (the encoder itself is verified against fixed vectors in payfast.test.ts). */
function itnBody(fields: Record<string, string>, passphrase: string = PAYFAST_SANDBOX.passphrase): string {
  const base = Object.entries(fields)
    .map(([k, v]) => `${k}=${phpUrlencode(v)}`)
    .join('&');
  const signature = createHash('md5').update(`${base}&passphrase=${phpUrlencode(passphrase)}`).digest('hex');
  return `${base}&signature=${signature}`;
}

function fields(order: Order, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    m_payment_id: order.reference,
    pf_payment_id: '1089250',
    payment_status: 'COMPLETE',
    item_name: 'Big Jo’s Paints order',
    item_description: '',
    amount_gross: '1798.00',
    amount_fee: '-41.35',
    amount_net: '1756.65',
    name_first: 'Thabo',
    email_address: 'thabo@example.com',
    merchant_id: PAYFAST_SANDBOX.merchantId,
    ...overrides,
  };
}

let store: MemoryStore;
let order: Order;
let deps: ItnDeps;

beforeEach(async () => {
  store = new MemoryStore();
  order = await store.createOrder(newOrder);
  deps = {
    store,
    payfast: { host: 'sandbox.payfast.co.za', ...PAYFAST_SANDBOX },
    isPayFastIp: vi.fn(async (ip: string) => ip === PAYFAST_IP),
    confirm: vi.fn(async () => 'valid' as const),
    onPaid: vi.fn(async () => {}),
    onReview: vi.fn(async () => {}),
  };
});

const status = async () => (await store.getByReference(order.reference))!.status;

describe('processItn', () => {

  it('marks a fully verified notification paid and notifies once', async () => {
    const result = await processItn(itnBody(fields(order)), PAYFAST_IP, deps);
    expect(result).toEqual({ httpStatus: 200, outcome: 'paid' });
    expect(await status()).toBe('paid');
    expect((await store.getByReference(order.reference))!.payfastPaymentId).toBe('1089250');
    expect(deps.onPaid).toHaveBeenCalledTimes(1);
  });

  it('treats a repeated notification as a no-op', async () => {
    await processItn(itnBody(fields(order)), PAYFAST_IP, deps);
    const again = await processItn(itnBody(fields(order)), PAYFAST_IP, deps);
    expect(again.outcome).toBe('duplicate');
    expect(deps.onPaid).toHaveBeenCalledTimes(1);
  });

  it('rejects a bad signature without touching the order', async () => {
    const forged = itnBody(fields(order), 'not-the-passphrase');
    const result = await processItn(forged, PAYFAST_IP, deps);
    expect(result).toEqual({ httpStatus: 400, outcome: 'bad_signature' });
    expect(await status()).toBe('pending_payment');
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it.each([
    ['amount mismatch', fields, { amount_gross: '1.00' }, PAYFAST_IP, /amount mismatch/],
    ['wrong merchant', fields, { merchant_id: '99999' }, PAYFAST_IP, /merchant_id/],
    ['unknown source IP', fields, {}, '203.0.113.9', /source IP/],
  ])('flags %s for review instead of marking paid', async (_name, build, overrides, ip, reason) => {
    const result = await processItn(itnBody(build(order, overrides)), ip, deps);
    expect(result.outcome).toBe('needs_review');
    expect(result.reasons?.join(' ')).toMatch(reason);
    expect(await status()).toBe('needs_review');
    expect(deps.onPaid).not.toHaveBeenCalled();
    expect(deps.onReview).toHaveBeenCalledTimes(1);
  });

  it('flags an INVALID server confirmation for review', async () => {
    deps.confirm = vi.fn(async () => 'invalid' as const);
    const result = await processItn(itnBody(fields(order)), PAYFAST_IP, deps);
    expect(result.outcome).toBe('needs_review');
    expect(await status()).toBe('needs_review');
  });

  it('asks PayFast to retry when its confirmation endpoint cannot be reached', async () => {
    deps.confirm = vi.fn(async () => 'error' as const);
    const result = await processItn(itnBody(fields(order)), PAYFAST_IP, deps);
    expect(result).toEqual({ httpStatus: 503, outcome: 'retry_later' });
    expect(await status()).toBe('pending_payment');
  });

  it('recovers a flagged order when a fully verified notification arrives', async () => {
    await processItn(itnBody(fields(order)), '203.0.113.9', deps);
    expect(await status()).toBe('needs_review');
    const result = await processItn(itnBody(fields(order)), PAYFAST_IP, deps);
    expect(result.outcome).toBe('paid');
    expect(await status()).toBe('paid');
  });

  it('records cancelled payments and ignores unknown orders', async () => {
    const cancelled = await processItn(itnBody(fields(order, { payment_status: 'CANCELLED' })), PAYFAST_IP, deps);
    expect(cancelled.outcome).toBe('cancelled');
    expect(await status()).toBe('cancelled');
    const unknown = await processItn(itnBody(fields(order, { m_payment_id: 'BJ-000000-NONE' })), PAYFAST_IP, deps);
    expect(unknown).toEqual({ httpStatus: 200, outcome: 'unknown_order' });
  });

  it('never downgrades a paid order', async () => {
    await processItn(itnBody(fields(order)), PAYFAST_IP, deps);
    await processItn(itnBody(fields(order, { payment_status: 'CANCELLED' })), PAYFAST_IP, deps);
    await processItn(itnBody(fields(order, { amount_gross: '1.00' })), PAYFAST_IP, deps);
    expect(await status()).toBe('paid');
  });
});
