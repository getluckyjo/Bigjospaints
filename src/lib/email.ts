/**
 * Transactional email through Resend. Email is best-effort: a failure is logged and never
 * undoes a recorded order. Without RESEND_API_KEY, messages are logged instead of sent.
 */
import { Resend } from 'resend';
import copy from '../content/copy.json';
import { business, deliveryDays } from './business';
import { emailConfig } from './config';
import { itemsHeading } from './cart';
import { formatLitres } from './estimate';
import { formatZar } from './money';
import type { Order } from './orders';

export interface Message {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export type Sender = (message: Message) => Promise<void>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function textToHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#292C27">${text
    .split('\n\n')
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;
}

export function resendSender(env: Record<string, string | undefined> = process.env): Sender {
  const cfg = emailConfig(env);
  if (!cfg.apiKey || !cfg.from) {
    return async (message) => {
      console.info(`[email not sent: RESEND_API_KEY/EMAIL_FROM unset] to=${message.to} subject="${message.subject}"`);
    };
  }
  const resend = new Resend(cfg.apiKey);
  return async (message) => {
    const { error } = await resend.emails.send({
      from: cfg.from!,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: textToHtml(message.text),
      replyTo: message.replyTo,
    });
    if (error) throw new Error(`Resend: ${error.message}`);
  };
}

function lineText(order: Order): string {
  return order.lines
    .map(
      (l) =>
        `${l.quantity} × ${formatLitres(l.sizeLitres)} ${l.brandName} ${l.productName}, ${l.colourName}${l.colourCode ? ` (${l.colourCode})` : ''}: ${formatZar(l.unitPriceCents * l.quantity)}`,
    )
    .join('\n');
}

function totals(order: Order): string {
  return [
    `${itemsHeading(order.lines)}: ${formatZar(order.subtotalCents)}`,
    `Delivery: ${order.deliveryFeeCents === null ? 'to be confirmed' : order.deliveryFeeCents === 0 ? 'free' : formatZar(order.deliveryFeeCents)}`,
    `Total paid: ${formatZar(order.totalCents)}`,
  ].join('\n');
}

/** A full link to a page on the site (PUBLIC_SITE_URL), or the bare path when that isn't set. */
function siteLink(path: string, env: Record<string, string | undefined>): string {
  return `${(env.PUBLIC_SITE_URL?.trim() ?? '').replace(/\/$/, '')}${path}`;
}

/** What's coming: "your paint", "your sample pots" or "your paint and sample pots". */
function whatsComing(order: Order): string {
  const paint = order.lines.some((l) => !l.isSample);
  const pots = order.lines.some((l) => l.isSample);
  return paint && pots ? 'your paint and sample pots' : pots ? 'your sample pots' : 'your paint';
}

/** The sampled colours, once each: "Desert Spring (Plascon)". */
function sampledColours(order: Order): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const l of order.lines) if (l.isSample && !seen.has(l.colourId)) seen.set(l.colourId, `${l.colourName} (${l.brandName})`);
  return [...seen].map(([id, label]) => ({ id, label }));
}

function address(order: Order): string {
  return [order.street, order.suburb, order.city, `${order.province} ${order.postalCode}`].join('\n');
}

export function customerConfirmation(order: Order, env: Record<string, string | undefined> = process.env): Message {
  const samples = sampledColours(order);
  const testing = samples.length
    ? [
        `How to test your sample pots:\n${copy.samples.testSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`,
        `The full guide is at ${siteLink('/samples#test', env)}. A few days after your samples arrive, we’ll email you once to see how the test patches look.`,
      ]
    : [];
  return {
    to: order.email,
    replyTo: emailConfig(env).ownerEmail ?? undefined,
    subject: `Your Big Jo’s Paints order ${order.reference}`,
    text: [
      `Hi ${order.firstName},`,
      `Thanks for your order. We’ve received your payment, and ${whatsComing(order)} will be delivered in ${deliveryDays} days.`,
      `Order ${order.reference}\n${lineText(order)}`,
      totals(order),
      `Delivery address:\n${address(order)}`,
      ...testing,
      'Big Jo’s Paints. Big on colour. Easy on you.',
    ].join('\n\n'),
  };
}

/** The one follow-up after a sample order: how do the patches look, and where to order the paint. */
export function sampleFollowUp(order: Order, env: Record<string, string | undefined> = process.env): Message {
  const samples = sampledColours(order);
  const one = samples.length === 1;
  return {
    to: order.email,
    replyTo: emailConfig(env).ownerEmail ?? undefined,
    subject: one ? `How does ${samples[0].label.replace(/ \(.*\)$/, '')} look on your wall?` : 'How do your test patches look?',
    text: [
      `Hi ${order.firstName},`,
      `Your sample pots from order ${order.reference} should have arrived a few days ago. How do the test patches look in your room, in daylight and at night?`,
      `When you’ve chosen, you can order the paint here:\n${samples.map((s) => `${s.label}: ${siteLink(`/colours/${s.id}`, env)}`).join('\n')}`,
      `For exactly how much paint you need and what it costs, give your colour consultant your room size: ${siteLink('/colour-consultant', env)}`,
      `Still deciding? Reply to this email${business.whatsapp ? ` or WhatsApp us on ${business.whatsapp}` : ''}, and we’ll help you choose.`,
      'This is the only follow-up we’ll send about this order.',
      'Big Jo’s Paints. Big on colour. Easy on you.',
    ].join('\n\n'),
  };
}

export function ownerPaidAlert(order: Order, ownerEmail: string): Message {
  const deliverBy = new Date(Date.parse(order.paidAt ?? order.createdAt) + deliveryDays * 86_400_000).toISOString().slice(0, 10);
  return {
    to: ownerEmail,
    replyTo: order.email,
    subject: `New paid paint order ${order.reference}: ${formatZar(order.totalCents)}`,
    text: [
      `Paid order ${order.reference}${order.commerceMode === 'sandbox' ? ' (SANDBOX TEST: no real payment)' : ''}`,
      `Deliver by ${deliverBy} (${deliveryDays} days).`,
      lineText(order),
      totals(order),
      `PayFast payment ID: ${order.payfastPaymentId ?? 'n/a'}`,
      `Customer: ${order.firstName} ${order.lastName}\n${order.email}\n${order.phone}`,
      `Deliver to:\n${address(order)}`,
      `Delivery notes: ${order.notes || 'none'}`,
    ].join('\n\n'),
  };
}

export function ownerReviewAlert(order: Order, reasons: string[], ownerEmail: string): Message {
  return {
    to: ownerEmail,
    subject: `Check order ${order.reference}: payment notification needs review`,
    text: [
      `A PayFast notification for order ${order.reference} (${formatZar(order.totalCents)}) did not pass every check, so the order was NOT marked as paid.`,
      `Failed checks: ${reasons.join(', ')}`,
      'Check the transaction in the PayFast dashboard before sending the paint. If the payment is genuine, mark the order as paid in Supabase.',
      `Customer: ${order.firstName} ${order.lastName}, ${order.email}, ${order.phone}`,
    ].join('\n\n'),
  };
}

/** Send without throwing; returns whether it went out. */
export async function trySend(send: Sender, message: Message): Promise<boolean> {
  try {
    await send(message);
    return true;
  } catch (error) {
    console.error(`[email failed] to=${message.to} subject="${message.subject}":`, error);
    return false;
  }
}
