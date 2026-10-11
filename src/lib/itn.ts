/**
 * PayFast Instant Transaction Notification (ITN) handling.
 *
 * An order becomes "paid" only when every PayFast check passes:
 *   1. signature (with passphrase)   3. merchant ID and amount match the order
 *   2. source IP is PayFast's        4. PayFast's server confirms the data (VALID)
 * A notification with a valid signature that fails another check never marks the
 * order paid; it is flagged "needs_review" and the owner is emailed.
 */
import type { PayFastConfig } from './config';
import { fromPayFastAmount } from './money';
import type { Order, OrderStore } from './orders';
import { itnParamString, parseItnBody, verifyItnSignature, type Confirmation } from './payfast';

export interface ItnDeps {
  store: OrderStore;
  payfast: PayFastConfig;
  isPayFastIp: (ip: string) => Promise<boolean>;
  confirm: (paramString: string) => Promise<Confirmation>;
  onPaid: (order: Order) => Promise<void>;
  onReview: (order: Order, reasons: string[]) => Promise<void>;
}

export type ItnOutcome =
  | 'paid'
  | 'duplicate'
  | 'needs_review'
  | 'cancelled'
  | 'failed'
  | 'ignored'
  | 'unknown_order'
  | 'bad_signature'
  | 'retry_later';

export interface ItnResult {
  httpStatus: number;
  outcome: ItnOutcome;
  reasons?: string[];
}

export async function processItn(body: string, ip: string, deps: ItnDeps): Promise<ItnResult> {
  const pairs = parseItnBody(body);
  if (!verifyItnSignature(pairs, deps.payfast.passphrase)) {
    return { httpStatus: 400, outcome: 'bad_signature' };
  }

  const data = Object.fromEntries(pairs);
  const reference = data.m_payment_id ?? '';
  const order = await deps.store.getByReference(reference);
  if (!order) return { httpStatus: 200, outcome: 'unknown_order' };

  const reasons: string[] = [];
  if (data.merchant_id !== deps.payfast.merchantId) reasons.push('merchant_id mismatch');
  const amountCents = fromPayFastAmount(data.amount_gross ?? '');
  if (!Number.isFinite(amountCents) || Math.abs(amountCents - order.totalCents) > 1) {
    reasons.push(`amount mismatch (expected ${order.totalCents / 100}, got ${data.amount_gross ?? 'none'})`);
  }
  if (!(await deps.isPayFastIp(ip))) reasons.push(`unrecognised source IP ${ip}`);

  const confirmation = await deps.confirm(itnParamString(pairs));
  // PayFast retries notifications that don't get a 200, so ask it to try again later.
  if (confirmation === 'error') return { httpStatus: 503, outcome: 'retry_later' };
  if (confirmation === 'invalid') reasons.push('PayFast server confirmation returned INVALID');

  const status = (data.payment_status ?? '').toUpperCase();
  const payload = data;

  if (reasons.length > 0) {
    if (status === 'COMPLETE') {
      const flagged = await deps.store.markStatus(
        reference,
        'needs_review',
        ['pending_payment', 'cancelled', 'failed'],
        { reasons, payload },
      );
      if (flagged) await deps.onReview(flagged, reasons);
    }
    return { httpStatus: 200, outcome: 'needs_review', reasons };
  }

  if (status === 'COMPLETE') {
    const paid = await deps.store.markPaid(reference, { payfastPaymentId: data.pf_payment_id ?? null, payload });
    if (!paid) return { httpStatus: 200, outcome: 'duplicate' };
    await deps.onPaid(paid);
    return { httpStatus: 200, outcome: 'paid' };
  }
  if (status === 'CANCELLED' || status === 'FAILED') {
    const next = status === 'CANCELLED' ? 'cancelled' : 'failed';
    await deps.store.markStatus(reference, next, ['pending_payment'], { payload });
    return { httpStatus: 200, outcome: next };
  }
  return { httpStatus: 200, outcome: 'ignored' };
}
