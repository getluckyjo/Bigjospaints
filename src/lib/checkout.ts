/**
 * Server-side work for checkout: creating the order from the cart, the signed PayFast hand-off
 * and the order status lookup. Route files call these, then redirect or set the status.
 */
import { deliveryFeeCents } from './business';
import { parseCart, priceCart, toOrderLines, type CartLine } from './cart';
import { commerceMode, payfastConfig, siteOrigin } from './config';
import { describeMix } from './estimate';
import { formatZar, toPayFastAmount } from './money';
import { getStore, tokenMatches, type Order } from './orders';
import { buildCheckoutForm, type Pair } from './payfast';
import { checkoutSchema, fieldErrors, formValues, type FieldErrors } from './validation';

export interface CheckoutState {
  lines: CartLine[];
  subtotalCents: number;
  totalCents: number;
  values: Record<string, string>;
  errors: FieldErrors;
  startError: boolean;
  status?: number;
  redirect?: string;
}

export function orderTotals(subtotalCents: number) {
  return { deliveryFeeCents, totalCents: subtotalCents + (deliveryFeeCents ?? 0) };
}

export async function handleCheckout(request: Request, cartCookie: string | undefined): Promise<CheckoutState> {
  const { lines, subtotalCents } = priceCart(parseCart(cartCookie));
  const state: CheckoutState = { lines, subtotalCents, totalCents: orderTotals(subtotalCents).totalCents, values: {}, errors: {}, startError: false };
  if (request.method !== 'POST' || lines.length === 0) return state;

  const form = await request.formData();
  const values = (state.values = formValues(form));
  if (values.website) {
    state.startError = true; // honeypot: almost certainly a bot
  } else {
    const parsed = checkoutSchema.safeParse(values);
    if (!parsed.success) {
      state.errors = fieldErrors(parsed.error);
    } else {
      const d = parsed.data;
      try {
        const order = await getStore().createOrder({
          lines: toOrderLines(lines),
          subtotalCents,
          deliveryFeeCents,
          totalCents: state.totalCents,
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email,
          phone: d.phone,
          street: d.street,
          suburb: d.suburb,
          city: d.city,
          province: d.province,
          postalCode: d.postalCode.replace(/\s+/g, ''),
          notes: d.notes || null,
          commerceMode: commerceMode(),
        });
        state.redirect = `/checkout/pay/${order.reference}?t=${encodeURIComponent(order.statusToken)}`;
        return state;
      } catch (error) {
        console.error('[checkout] could not create order', error);
        state.startError = true;
      }
    }
  }
  state.status = 422;
  return state;
}

export type PayState =
  | { kind: 'missing' }
  | { kind: 'redirect'; to: string }
  | { kind: 'form'; reference: string; action: string; fields: Pair[] };

export async function preparePayment(reference: string, token: string | null, url: URL): Promise<PayState> {
  const order = await getStore().getByReference(reference);
  if (!order || !tokenMatches(order, token)) return { kind: 'missing' };
  const orderUrl = `/order/${order.reference}?t=${encodeURIComponent(order.statusToken)}`;
  if (order.status === 'paid' || order.status === 'needs_review') return { kind: 'redirect', to: orderUrl };

  const origin = siteOrigin(url);
  const litres = order.lines.reduce((sum, l) => sum + l.sizeLitres * l.quantity, 0);
  const colourNames = [...new Set(order.lines.map((l) => l.colourName))];
  const { action, fields } = buildCheckoutForm(
    {
      reference: order.reference,
      amount: toPayFastAmount(order.totalCents),
      itemName: `Big Jo’s Paints order ${order.reference}`,
      itemDescription: `${litres} L of paint: ${colourNames.join(', ')}. ${order.lines.length} line${order.lines.length === 1 ? '' : 's'}, ${formatZar(order.totalCents)}.`,
      firstName: order.firstName,
      lastName: order.lastName,
      email: order.email,
      cellNumber: order.phone,
      returnUrl: `${origin}${orderUrl}`,
      cancelUrl: `${origin}/checkout/cancelled`,
      notifyUrl: `${origin}/api/payfast/itn`,
      customInt1: order.lines.length,
    },
    payfastConfig(),
  );
  return { kind: 'form', reference: order.reference, action, fields };
}

/** The order for a status page, only with its matching token. */
export async function findOrder(reference: string, token: string | null): Promise<Order | null> {
  try {
    const found = await getStore().getByReference(reference);
    return found && tokenMatches(found, token) ? found : null;
  } catch (error) {
    console.error('[order] lookup failed', error);
    return null;
  }
}

export { describeMix };
