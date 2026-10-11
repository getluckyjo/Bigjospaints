import { afterEach, describe, expect, it, vi } from 'vitest';
import { customerConfirmation, sampleFollowUp } from '../../src/lib/email';
import { cronAuthorised, handleFollowUpCron, sendSampleFollowUps } from '../../src/lib/follow-ups';
import { MemoryStore, type NewOrder, type OrderLine } from '../../src/lib/orders';
import copy from '../../src/content/copy.json';

const DAY = 86_400_000;
const NOW = new Date('2026-10-20T07:00:00Z');

const paint: OrderLine = {
  productId: 'plascon-double-velvet',
  productName: 'Double Velvet',
  brandName: 'Plascon',
  colourId: 'plascon-ray-of-light',
  colourName: 'Ray Of Light',
  colourCode: 'O7-A2-3',
  sizeLitres: 5,
  quantity: 2,
  unitPriceCents: 89900,
};
const pot = (colourId: string, colourName: string, brandName = 'Plascon'): OrderLine => ({
  productId: 'plascon-perfect-colour-matt-tester',
  productName: 'Perfect Colour Matt tester',
  brandName,
  colourId,
  colourName,
  colourCode: null,
  isSample: true,
  sizeLitres: 0.25,
  quantity: 1,
  unitPriceCents: 4500,
});

const base: Omit<NewOrder, 'lines'> = {
  subtotalCents: 9000,
  deliveryFeeCents: null,
  totalCents: 9000,
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

/** A paid order, paid `daysAgo` days before NOW. */
async function paidOrder(store: MemoryStore, lines: OrderLine[], daysAgo: number) {
  const order = await store.createOrder({ ...base, lines });
  await store.markPaid(order.reference, { payfastPaymentId: '1', payload: {} });
  store.orders.get(order.reference)!.paidAt = new Date(NOW.getTime() - daysAgo * DAY).toISOString();
  return order.reference;
}

afterEach(() => vi.unstubAllEnvs());

describe('sample follow-up emails', () => {
  it('emails each sample order once, a week after payment', async () => {
    const store = new MemoryStore();
    const due = await paidOrder(store, [pot('plascon-ray-of-light', 'Ray Of Light'), pot('plascon-white-clay', 'White Clay')], 8);
    await paidOrder(store, [pot('plascon-ray-of-light', 'Ray Of Light')], 3); // not delivered and tested yet
    await paidOrder(store, [paint], 8); // paint only: no follow-up
    await paidOrder(store, [pot('plascon-ray-of-light', 'Ray Of Light')], 45); // too old to write to now
    const unpaid = await store.createOrder({ ...base, lines: [pot('plascon-ray-of-light', 'Ray Of Light')] });
    store.orders.get(unpaid.reference)!.createdAt = new Date(NOW.getTime() - 8 * DAY).toISOString();

    const sent: { to: string; subject: string; text: string }[] = [];
    const send = vi.fn(async (m: { to: string; subject: string; text: string }) => void sent.push(m));
    expect(await sendSampleFollowUps(store, send, NOW, 7)).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(sent[0].to).toBe('thabo@example.com');
    expect(sent[0].subject).toBe('How do your test patches look?');
    expect(sent[0].text).toContain(`order ${due}`);
    expect(sent[0].text).toContain('Ray Of Light (Plascon): /colours/plascon-ray-of-light');
    expect(sent[0].text).toContain('White Clay (Plascon): /colours/plascon-white-clay');
    expect(sent[0].text).toContain('This is the only follow-up we’ll send about this order.');
    expect(store.orders.get(due)!.followUpSentAt).toBeTruthy();

    // The next day: nothing more to send.
    expect(await sendSampleFollowUps(store, send, new Date(NOW.getTime() + DAY), 7)).toEqual({ due: 0, sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('tries again the next day when the email fails', async () => {
    const store = new MemoryStore();
    const ref = await paidOrder(store, [pot('plascon-ray-of-light', 'Ray Of Light')], 7.5);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error('Resend down');
    });
    expect(await sendSampleFollowUps(store, failing, NOW, 7)).toEqual({ due: 1, sent: 0, failed: 1 });
    expect(store.orders.get(ref)!.followUpSentAt).toBeNull();
    const ok = vi.fn(async () => {});
    expect(await sendSampleFollowUps(store, ok, NOW, 7)).toMatchObject({ sent: 1 });
    errors.mockRestore();
  });

  it('names the colour when there’s one, with full links and WhatsApp', () => {
    const order = { ...base, lines: [pot('plascon-ray-of-light', 'Ray Of Light')], reference: 'BJP-261013-ABCD' } as never;
    const message = sampleFollowUp(order, { PUBLIC_SITE_URL: 'https://bigjospaints.vercel.app/', OWNER_EMAIL: 'owner@example.com' });
    expect(message.subject).toBe('How does Ray Of Light look on your wall?');
    expect(message.replyTo).toBe('owner@example.com');
    expect(message.text).toContain('Ray Of Light (Plascon): https://bigjospaints.vercel.app/colours/plascon-ray-of-light');
    expect(message.text).toContain('https://bigjospaints.vercel.app/colour-consultant');
    expect(message.text).toContain('WhatsApp us on +27 60 961 5091');
  });
});

describe('order confirmation', () => {
  it('adds the testing guide when the order has sample pots', () => {
    const withPots = customerConfirmation({ ...base, lines: [paint, pot('plascon-ray-of-light', 'Ray Of Light')], reference: 'BJP-1' } as never, {});
    expect(withPots.text).toContain('your paint and sample pots will be delivered in 3 days');
    expect(withPots.text).toContain(`1. ${copy.samples.testSteps[0]}`);
    expect(withPots.text).toContain('/samples#test');
    const potsOnly = customerConfirmation({ ...base, lines: [pot('plascon-ray-of-light', 'Ray Of Light')], reference: 'BJP-2' } as never, {});
    expect(potsOnly.text).toContain('your sample pots will be delivered');
    const paintOnly = customerConfirmation({ ...base, lines: [paint], reference: 'BJP-3' } as never, {});
    expect(paintOnly.text).toContain('your paint will be delivered');
    expect(paintOnly.text).not.toContain('How to test');
  });
});

describe('follow-up cron', () => {
  const request = (auth?: string) => new Request('https://bigjospaints.vercel.app/api/cron/sample-follow-ups', { headers: auth ? { authorization: auth } : {} });

  it('only runs with Vercel’s CRON_SECRET', async () => {
    expect(cronAuthorised(request('Bearer s3cret'), {})).toBe(false);
    expect(cronAuthorised(request('Bearer wrong'), { CRON_SECRET: 's3cret' })).toBe(false);
    expect(cronAuthorised(request(), { CRON_SECRET: 's3cret' })).toBe(false);
    expect(cronAuthorised(request('Bearer s3cret'), { CRON_SECRET: 's3cret' })).toBe(true);
    expect((await handleFollowUpCron(request('Bearer s3cret'), {})).status).toBe(503);
    expect((await handleFollowUpCron(request('Bearer wrong'), { CRON_SECRET: 's3cret' })).status).toBe(401);
  });

  it('says so when there’s no order database', async () => {
    const res = await handleFollowUpCron(request('Bearer s3cret'), { CRON_SECRET: 's3cret' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/SUPABASE_URL/);
  });
});
