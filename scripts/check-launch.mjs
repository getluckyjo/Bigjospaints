// Runs before every build. In live mode (COMMERCE_MODE=live) the build fails until every launch
// input is supplied, so real payments can never be taken by a half-configured shop.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const mode = (env.COMMERCE_MODE ?? 'sandbox').trim().toLowerCase();
if (!['sandbox', 'live'].includes(mode)) {
  console.error(`[launch check] COMMERCE_MODE must be sandbox or live (got "${env.COMMERCE_MODE}").`);
  process.exit(1);
}

const business = JSON.parse(fs.readFileSync(path.join(root, 'src/config/business.json'), 'utf8'));
const missing = [];
for (const key of ['legalName', 'registrationNumber', 'physicalAddress', 'email']) {
  if (!business[key]) missing.push(`src/config/business.json → ${key} (required on a South African online shop, ECTA s43)`);
}
if (business.vatRegistered && !business.vatNumber) missing.push('src/config/business.json → vatNumber');
if (business.delivery?.feeCents == null) missing.push('src/config/business.json → delivery.feeCents (0 for free delivery)');
for (const slug of ['terms-of-sale', 'delivery-and-returns', 'privacy']) {
  if (!fs.existsSync(path.join(root, 'src/content/policies', `${slug}.md`))) missing.push(`src/content/policies/${slug}.md (owner-approved policy)`);
}
for (const key of [
  'PUBLIC_SITE_URL',
  'PAYFAST_MERCHANT_ID',
  'PAYFAST_MERCHANT_KEY',
  'PAYFAST_PASSPHRASE',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'OWNER_EMAIL',
  'OPENAI_API_KEY',
]) {
  if (!env[key]) missing.push(`environment variable ${key}`);
}
if (env.PAYFAST_MERCHANT_ID === '10000100') missing.push('PAYFAST_MERCHANT_ID is the public sandbox account');
if (env.ORDER_STORE === 'memory') missing.push('ORDER_STORE=memory is for testing only');
const catalogue = fs.readFileSync(path.join(root, 'src/data/catalogue.json'), 'utf8');
if (catalogue.includes('PLACEHOLDER')) missing.push('src/data/catalogue.json is still the placeholder');

if (missing.length === 0) {
  console.log(`[launch check] ${mode}: all launch inputs present.`);
} else if (mode === 'live') {
  console.error(`[launch check] COMMERCE_MODE=live, but these launch inputs are missing:\n  - ${missing.join('\n  - ')}`);
  process.exit(1);
} else {
  console.log(`[launch check] ${mode} mode. Before switching to live, supply:\n  - ${missing.join('\n  - ')}`);
}
