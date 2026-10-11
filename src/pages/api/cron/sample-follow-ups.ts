import type { APIRoute } from 'astro';
import { handleFollowUpCron } from '../../../lib/follow-ups';

export const prerender = false;

/** Called once a day by Vercel Cron (vercel.json), with Authorization: Bearer $CRON_SECRET. */
export const GET: APIRoute = ({ request }) => handleFollowUpCron(request);
