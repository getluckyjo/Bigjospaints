import { defineMiddleware } from 'astro:middleware';

/**
 * 1. Same-origin check for form posts (CSRF protection), replacing Astro's built-in
 *    security.checkOrigin so PayFast's server-to-server ITN can reach its endpoint.
 *    The ITN route authenticates requests itself (signature, source IP, server confirmation).
 * 2. Security headers on on-demand pages (checkout, PayFast hand-off, contact, orders).
 *    vercel.json sets the same headers for static pages.
 */
const EXEMPT_PATHS = new Set(['/api/payfast/itn']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy':
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://www.payfast.co.za https://sandbox.payfast.co.za",
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, isPrerendered } = context;
  if (isPrerendered) return next();

  if (!SAFE_METHODS.has(request.method) && !EXEMPT_PATHS.has(url.pathname)) {
    const origin = request.headers.get('origin');
    const allowed = new Set([url.origin]);
    if (process.env.PUBLIC_SITE_URL) allowed.add(new URL(process.env.PUBLIC_SITE_URL).origin);
    if (!origin || !allowed.has(origin)) {
      return new Response('Cross-site form submissions are forbidden', { status: 403 });
    }
  }

  const response = await next();
  try {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(key, value);
  } catch {
    // Some responses (e.g. Response.redirect) have immutable headers; nothing to protect there.
  }
  return response;
});
