/**
 * Order storage. Supabase in deployed environments; an in-memory store only when
 * ORDER_STORE=memory is set explicitly (local development, tests and the test shop).
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type OrderStatus = 'pending_payment' | 'paid' | 'cancelled' | 'failed' | 'needs_review';

/** One line of an order, priced from the catalogue when the order was placed. */
export interface OrderLine {
  productId: string;
  productName: string;
  brandName: string;
  colourId: string;
  colourName: string;
  colourCode: string | null;
  sizeLitres: number;
  quantity: number;
  unitPriceCents: number;
}

export interface NewOrder {
  lines: OrderLine[];
  subtotalCents: number;
  /** null while the owner hasn't set a delivery fee (test shop only). */
  deliveryFeeCents: number | null;
  totalCents: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  notes: string | null;
  commerceMode: 'sandbox' | 'live';
}

export interface Order extends NewOrder {
  id: string;
  reference: string;
  statusToken: string;
  status: OrderStatus;
  payfastPaymentId: string | null;
  reviewReasons: string[] | null;
  createdAt: string;
  paidAt: string | null;
}

export interface PaymentUpdate {
  payfastPaymentId: string | null;
  payload: Record<string, string>;
}

export interface OrderStore {
  createOrder(input: NewOrder): Promise<Order>;
  getByReference(reference: string): Promise<Order | null>;
  /** Moves any unpaid order to paid. Returns null when it was already paid (duplicate ITN) or not found. */
  markPaid(reference: string, update: PaymentUpdate): Promise<Order | null>;
  /** Sets a status only if the order is currently in one of `from`. */
  markStatus(
    reference: string,
    status: Exclude<OrderStatus, 'paid'>,
    from: OrderStatus[],
    extra?: { reasons?: string[]; payload?: Record<string, string> },
  ): Promise<Order | null>;
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. BJP-261011-K7QX */
export function newReference(now = new Date()): string {
  const date = now.toISOString().slice(2, 10).replace(/-/g, '');
  const bytes = randomBytes(4);
  const suffix = [...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
  return `BJP-${date}-${suffix}`;
}

export function newStatusToken(): string {
  return randomBytes(18).toString('base64url');
}

export function tokenMatches(order: Order, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(order.statusToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- In-memory store (development, tests and the test shop) ----------

export class MemoryStore implements OrderStore {
  orders = new Map<string, Order>();

  async createOrder(input: NewOrder): Promise<Order> {
    let reference = newReference();
    while (this.orders.has(reference)) reference = newReference();
    const order: Order = {
      ...structuredClone(input),
      id: randomUUID(),
      reference,
      statusToken: newStatusToken(),
      status: 'pending_payment',
      payfastPaymentId: null,
      reviewReasons: null,
      createdAt: new Date().toISOString(),
      paidAt: null,
    };
    this.orders.set(reference, order);
    return structuredClone(order);
  }

  async getByReference(reference: string): Promise<Order | null> {
    const order = this.orders.get(reference);
    return order ? structuredClone(order) : null;
  }

  async markPaid(reference: string, update: PaymentUpdate): Promise<Order | null> {
    const order = this.orders.get(reference);
    if (!order || order.status === 'paid') return null;
    Object.assign(order, {
      status: 'paid',
      payfastPaymentId: update.payfastPaymentId,
      reviewReasons: null,
      paidAt: new Date().toISOString(),
    });
    return structuredClone(order);
  }

  async markStatus(
    reference: string,
    status: Exclude<OrderStatus, 'paid'>,
    from: OrderStatus[],
    extra?: { reasons?: string[] },
  ): Promise<Order | null> {
    const order = this.orders.get(reference);
    if (!order || !from.includes(order.status)) return null;
    order.status = status;
    if (extra?.reasons) order.reviewReasons = extra.reasons;
    return structuredClone(order);
  }
}

// ---------- Supabase store ----------

interface OrderRow {
  id: string;
  reference: string;
  status_token: string;
  status: OrderStatus;
  commerce_mode: 'sandbox' | 'live';
  lines: OrderLine[];
  subtotal_cents: number;
  delivery_fee_cents: number | null;
  total_cents: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  street: string;
  suburb: string;
  city: string;
  province: string;
  postal_code: string;
  notes: string | null;
  payfast_payment_id: string | null;
  review_reasons: string[] | null;
  created_at: string;
  paid_at: string | null;
}

function fromRow(row: OrderRow): Order {
  return {
    id: row.id,
    reference: row.reference,
    statusToken: row.status_token,
    status: row.status,
    commerceMode: row.commerce_mode,
    lines: row.lines,
    subtotalCents: row.subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    totalCents: row.total_cents,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    street: row.street,
    suburb: row.suburb,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    notes: row.notes,
    payfastPaymentId: row.payfast_payment_id,
    reviewReasons: row.review_reasons,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

export class SupabaseStore implements OrderStore {
  constructor(private db: SupabaseClient) {}

  async createOrder(input: NewOrder): Promise<Order> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await this.db
        .from('orders')
        .insert({
          reference: newReference(),
          status_token: newStatusToken(),
          status: 'pending_payment',
          commerce_mode: input.commerceMode,
          lines: input.lines,
          subtotal_cents: input.subtotalCents,
          delivery_fee_cents: input.deliveryFeeCents,
          total_cents: input.totalCents,
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email,
          phone: input.phone,
          street: input.street,
          suburb: input.suburb,
          city: input.city,
          province: input.province,
          postal_code: input.postalCode,
          notes: input.notes,
        })
        .select()
        .single();
      if (!error) return fromRow(data as OrderRow);
      if (error.code !== '23505') throw new Error(`Could not create order: ${error.message}`); // 23505 = duplicate reference
    }
    throw new Error('Could not create a unique order reference');
  }

  async getByReference(reference: string): Promise<Order | null> {
    const { data, error } = await this.db.from('orders').select().eq('reference', reference).maybeSingle();
    if (error) throw new Error(`Could not load order: ${error.message}`);
    return data ? fromRow(data as OrderRow) : null;
  }

  async markPaid(reference: string, update: PaymentUpdate): Promise<Order | null> {
    const { data, error } = await this.db
      .from('orders')
      .update({
        status: 'paid',
        payfast_payment_id: update.payfastPaymentId,
        itn_payload: update.payload,
        review_reasons: null,
        paid_at: new Date().toISOString(),
      })
      .eq('reference', reference)
      .neq('status', 'paid')
      .select()
      .maybeSingle();
    if (error) throw new Error(`Could not mark order paid: ${error.message}`);
    return data ? fromRow(data as OrderRow) : null;
  }

  async markStatus(
    reference: string,
    status: Exclude<OrderStatus, 'paid'>,
    from: OrderStatus[],
    extra?: { reasons?: string[]; payload?: Record<string, string> },
  ): Promise<Order | null> {
    const changes: Record<string, unknown> = { status };
    if (extra?.reasons) changes.review_reasons = extra.reasons;
    if (extra?.payload) changes.itn_payload = extra.payload;
    const { data, error } = await this.db
      .from('orders')
      .update(changes)
      .eq('reference', reference)
      .in('status', from)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Could not update order: ${error.message}`);
    return data ? fromRow(data as OrderRow) : null;
  }
}

// ---------- Selection ----------

let store: OrderStore | null = null;

export function getStore(env: Record<string, string | undefined> = process.env): OrderStore {
  if (store) return store;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    store = new SupabaseStore(
      createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
    );
  } else if (env.ORDER_STORE === 'memory' && env.COMMERCE_MODE !== 'live') {
    // Survives Vite module reloads in `astro dev`.
    const g = globalThis as { __bjpMemoryStore?: MemoryStore };
    store = g.__bjpMemoryStore ??= new MemoryStore();
  } else {
    throw new Error('Order storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return store;
}

/** Test hook. */
export function setStore(next: OrderStore | null): void {
  store = next;
}
