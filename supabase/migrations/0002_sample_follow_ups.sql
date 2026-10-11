-- Big Jo's Paints: the sample follow-up email (src/lib/follow-ups.ts).
-- One email per paid order with sample pots, a few days after delivery; this records that it went out.

alter table public.orders add column follow_up_sent_at timestamptz;

-- The daily job looks for paid orders without a follow-up yet.
create index orders_follow_up_due_idx on public.orders (paid_at)
  where status = 'paid' and follow_up_sent_at is null;
