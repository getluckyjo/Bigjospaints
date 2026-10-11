/**
 * The sample follow-up: once a day (the cron in vercel.json), email each customer whose sample
 * order was paid `sampleFollowUpDays` ago to ask how the test patches look. Each order gets one
 * email at most: it's claimed in the database before sending, and released again if sending fails
 * so the next day's run retries it.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { sampleFollowUpDays } from './business';
import { resendSender, sampleFollowUp, type Sender } from './email';
import { getStore, type OrderStore } from './orders';

const DAY_MS = 86_400_000;
/** Orders older than this are skipped, so switching the emails on doesn't write to old customers. */
const MAX_AGE_DAYS = 30;
const BATCH = 50;

export interface FollowUpRun {
  due: number;
  sent: number;
  failed: number;
}

export async function sendSampleFollowUps(store: OrderStore, send: Sender, now = new Date(), afterDays = sampleFollowUpDays): Promise<FollowUpRun> {
  const to = new Date(now.getTime() - afterDays * DAY_MS);
  const from = new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS);
  const due = await store.sampleFollowUpsDue(from, to, BATCH);
  const run: FollowUpRun = { due: due.length, sent: 0, failed: 0 };
  for (const order of due) {
    if (!(await store.claimFollowUp(order.reference))) continue;
    try {
      await send(sampleFollowUp(order));
      run.sent++;
    } catch (error) {
      console.error(`[follow-up] ${order.reference}:`, error);
      await store.releaseFollowUp(order.reference).catch(() => {});
      run.failed++;
    }
  }
  return run;
}

const sha = (value: string) => createHash('sha256').update(value).digest();

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret set, the job doesn't run. */
export function cronAuthorised(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return false;
  return timingSafeEqual(sha(request.headers.get('authorization') ?? ''), sha(`Bearer ${secret}`));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handleFollowUpCron(request: Request, env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (!env.CRON_SECRET?.trim()) return json({ error: 'CRON_SECRET is not set' }, 503);
  if (!cronAuthorised(request, env)) return json({ error: 'Unauthorised' }, 401);
  let store: OrderStore;
  try {
    store = getStore(env);
  } catch (error) {
    return json({ error: (error as Error).message }, 503);
  }
  const run = await sendSampleFollowUps(store, resendSender(env));
  console.info('[follow-up]', run);
  return json(run);
}
