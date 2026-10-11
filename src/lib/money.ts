/** Money is handled in integer cents throughout; these helpers only format it. */

/** "R24,999" for whole rands, "R24,999.50" otherwise. */
export function formatZar(cents: number): string {
  const rands = Math.floor(cents / 100);
  const rest = cents % 100;
  const whole = rands.toLocaleString('en-US');
  return rest === 0 ? `R${whole}` : `R${whole}.${String(rest).padStart(2, '0')}`;
}

/** PayFast amount format: "24999.00". */
export function toPayFastAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Parse a PayFast amount ("24999.00") back to cents. Returns NaN for malformed input. */
export function fromPayFastAmount(value: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim())) return Number.NaN;
  return Math.round(Number.parseFloat(value) * 100);
}

/** Replace {name} placeholders in a copy string. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
