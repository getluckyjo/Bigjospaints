import type { APIRoute } from 'astro';
import { handlePreviewPost } from '../../lib/preview';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let ip = '';
  try {
    ip = clientAddress;
  } catch {
    ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  }
  return handlePreviewPost(request, ip);
};
