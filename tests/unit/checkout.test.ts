import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serializeCart, type CartEntry } from '../../src/lib/cart';
import { colours, productsFor, sizesFor } from '../../src/lib/catalogue';
import { handleCheckout, preparePayment } from '../../src/lib/checkout';
import { customerConfirmation, ownerPaidAlert } from '../../src/lib/email';
import { MemoryStore, setStore } from '../../src/lib/orders';

const colour = colours.find((c) => c.brand === 'duram' && c.base === 'light')!;
const product = productsFor('duram')[0];
const size = sizesFor(product, colour).find((s) => s.litres === 5)!;
const cart = serializeCart([[product.id, colour.id, 5, 2] as CartEntry]);

const details = {
  firstName: 'Lerato',
  lastName: 'Dlamini',
  email: 'lerato@example.com',
  phone: '082 123 4567',
  street: '12 Jacaranda Street',
  suburb: 'Parkhurst',
  city: 'Johannesburg',
  province: 'Gauteng',
  postalCode: '2193',
  accept: 'yes',
};

function post(values: Record<string, string>) {
  return new Request('http://localhost/checkout', { method: 'POST', body: new URLSearchParams(values) });
}

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
  setStore(store);
});
afterEach(() => setStore(null));

describe('checkout', () => {
  it('creates an order priced from the catalogue and sends the customer to pay', async () => {
    const state = await handleCheckout(post(details), cart);
    expect(state.redirect).toMatch(/^\/checkout\/pay\/BJP-\d{6}-[A-Z2-9]{4}\?t=/);
    const order = [...store.orders.values()][0];
    expect(order.lines).toEqual([
      expect.objectContaining({ productId: product.id, colourId: colour.id, sizeLitres: 5, quantity: 2, unitPriceCents: size.priceCents }),
    ]);
    expect(order.subtotalCents).toBe(size.priceCents * 2);
    expect(order.totalCents).toBe(size.priceCents * 2);
    expect(order.province).toBe('Gauteng');
  });

  it('explains missing details and doesn’t create an order', async () => {
    const state = await handleCheckout(post({ ...details, province: '', email: 'nope', accept: '' }), cart);
    expect(state.status).toBe(422);
    expect(Object.keys(state.errors)).toEqual(expect.arrayContaining(['province', 'email', 'accept']));
    expect(store.orders.size).toBe(0);
  });

  it('does nothing for an empty cart', async () => {
    const state = await handleCheckout(post(details), undefined);
    expect(state.lines).toEqual([]);
    expect(state.redirect).toBeUndefined();
  });

  it('signs a PayFast form for the order total', async () => {
    const state = await handleCheckout(post(details), cart);
    const [, reference, token] = state.redirect!.match(/pay\/([^?]+)\?t=(.+)$/)!;
    const pay = await preparePayment(reference, decodeURIComponent(token), new URL('https://bigjospaints.example/'));
    expect(pay.kind).toBe('form');
    if (pay.kind !== 'form') return;
    const fields = Object.fromEntries(pay.fields);
    expect(fields.amount).toBe((size.priceCents * 2 / 100).toFixed(2));
    expect(fields.return_url).toBe(`https://bigjospaints.example/order/${reference}?t=${token}`);
    expect(fields.notify_url).toBe('https://bigjospaints.example/api/payfast/itn');
    expect(fields.signature).toMatch(/^[a-f0-9]{32}$/);
    expect((await preparePayment(reference, 'wrong', new URL('https://x.example/'))).kind).toBe('missing');
  });

  it('emails the customer and the owner', async () => {
    await handleCheckout(post(details), cart);
    const order = [...store.orders.values()][0];
    const customer = customerConfirmation(order, { OWNER_EMAIL: 'owner@example.com' });
    expect(customer.subject).toContain(order.reference);
    expect(customer.text).toContain('delivered in 3 days');
    expect(customer.text).toContain(colour.name);
    expect(customer.replyTo).toBe('owner@example.com');
    const owner = ownerPaidAlert({ ...order, paidAt: '2026-10-11T08:00:00.000Z' }, 'owner@example.com');
    expect(owner.text).toContain('Deliver by 2026-10-14');
    expect(owner.text).toContain('SANDBOX TEST');
  });
});
