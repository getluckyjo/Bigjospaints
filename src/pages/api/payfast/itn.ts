/**
 * PayFast ITN (notify_url). PayFast POSTs here server-to-server after each payment.
 * Exempt from the same-origin check in src/middleware.ts; authenticated in processItn().
 */
import type { APIRoute } from 'astro';
import { emailConfig, payfastConfig } from '../../../lib/config';
import { customerConfirmation, ownerPaidAlert, ownerReviewAlert, resendSender, trySend } from '../../../lib/email';
import { processItn } from '../../../lib/itn';
import { getStore } from '../../../lib/orders';
import { confirmWithPayFast, isPayFastIp } from '../../../lib/payfast';

export const prerender = false;

function sourceIp(request: Request, clientAddress: () => string): string {
  try {
    return clientAddress();
  } catch {
    return request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  }
}

export const POST: APIRoute = async (context) => {
  const body = await context.request.text();
  const ip = sourceIp(context.request, () => context.clientAddress);
  const payfast = payfastConfig();
  const send = resendSender();
  const { ownerEmail } = emailConfig();

  try {
    const result = await processItn(body, ip, {
      store: getStore(),
      payfast,
      isPayFastIp: (address) => isPayFastIp(address),
      confirm: (paramString) => confirmWithPayFast(paramString, payfast.host),
      onPaid: async (order) => {
        await trySend(send, customerConfirmation(order));
        if (ownerEmail) await trySend(send, ownerPaidAlert(order, ownerEmail));
      },
      onReview: async (order, reasons) => {
        if (ownerEmail) await trySend(send, ownerReviewAlert(order, reasons, ownerEmail));
      },
    });
    console.info(`[itn] ${result.outcome}${result.reasons ? `: ${result.reasons.join('; ')}` : ''} (from ${ip})`);
    return new Response(result.outcome, { status: result.httpStatus });
  } catch (error) {
    console.error('[itn] failed', error);
    return new Response('retry', { status: 500 });
  }
};
