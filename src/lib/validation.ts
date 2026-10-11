import { z } from 'zod';
import { PROVINCES } from './business';

const text = (max: number) => z.string().trim().max(max);
const required = (max: number, message: string) => text(max).min(1, message);

/** Missing fields count as empty, so the friendly "Enter your …" messages always apply. */
function form<T extends z.ZodRawShape>(shape: T) {
  const keys = Object.keys(shape);
  return z.preprocess((input) => {
    const values: Record<string, unknown> = input && typeof input === 'object' ? { ...input } : {};
    for (const key of keys) values[key] ??= '';
    return values;
  }, z.object(shape));
}

export const checkoutSchema = form({
  firstName: required(100, 'Enter your first name.'),
  lastName: required(100, 'Enter your last name.'),
  email: text(254).pipe(z.email('Enter an email address like name@example.com.')),
  phone: text(30).refine((v) => /^\+?[\d\s()-]{9,}$/.test(v), 'Enter a phone number we can reach you on.'),
  street: required(200, 'Enter the street address.'),
  suburb: required(100, 'Enter the suburb.'),
  city: required(100, 'Enter the town or city.'),
  province: z.enum(PROVINCES, { error: 'Choose your province.' }),
  postalCode: text(10).refine((v) => /^\d{4}$/.test(v.replace(/\s+/g, '')), 'Enter a four-digit postal code.'),
  notes: text(1000).optional().default(''),
  accept: z.literal('yes', { error: 'Please confirm to continue.' }),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

/** Form values as plain strings, for re-rendering after an error. */
export function formValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') values[key] = value;
  return values;
}
