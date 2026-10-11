import data from '../config/business.json';

/** Owner-supplied business details (src/config/business.json); null until supplied. */
export interface Business {
  tradingName: string;
  legalName: string | null;
  registrationNumber: string | null;
  physicalAddress: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  delivery: { days: number; feeCents: number | null };
}

export const business = data as unknown as Business;

export const deliveryDays = business.delivery.days;
/** null while the owner hasn't set a fee: shown as "to be confirmed" and not charged (test shop only). */
export const deliveryFeeCents = business.delivery.feeCents;

/** wa.me link to the business WhatsApp with an optional prefilled message; null when no number is set. */
export function whatsappHref(text?: string): string | null {
  if (!business.whatsapp) return null;
  const digits = business.whatsapp.replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export const PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
  'Western Cape',
] as const;
