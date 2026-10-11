/** Cart form posts: add from a colour page or the consultant, change a quantity, remove a line. */
import { addToCart, lineKey, parseCart, sampleEntry, setQuantity, validEntry, type CartEntry } from './cart';

export function applyCartAction(current: CartEntry[], form: FormData): { entries: CartEntry[]; added: number } {
  const action = String(form.get('action') ?? '');
  if (action === 'add') {
    // From the consultant: one or more "productId|colourId|litres|qty" lines (its tin mix).
    const additions = form
      .getAll('line')
      .map((value) => String(value).split('|'))
      .map(([product, colour, litres, qty]) => validEntry([product, colour, Number(litres), Number(qty)]))
      .filter((e): e is CartEntry => e !== null);
    return { entries: addToCart(current, additions), added: additions.reduce((n, a) => n + a[3], 0) };
  }
  if (action === 'add-sample') {
    // A sample pot, from a colour page or the consultant.
    const entry = sampleEntry(String(form.get('colour') ?? ''), String(form.get('sample') ?? ''), Number(form.get('qty') ?? 1));
    return { entries: entry ? addToCart(current, [entry]) : current, added: entry ? entry[3] : 0 };
  }
  if (action === 'add-one') {
    // From a colour page: colour, "productId|litres" and a quantity.
    const [product, litres] = String(form.get('size') ?? '').split('|');
    const entry = validEntry([product, String(form.get('colour') ?? ''), Number(litres), Number(form.get('qty') ?? 1)]);
    return { entries: entry ? addToCart(current, [entry]) : current, added: entry ? entry[3] : 0 };
  }
  const key = String(form.get('key') ?? '');
  if (action === 'update') {
    const qty = Math.floor(Number(form.get('qty')));
    return { entries: setQuantity(current, key, Number.isFinite(qty) ? qty : 1), added: 0 };
  }
  if (action === 'remove') {
    return { entries: current.filter((e) => lineKey(e[0], e[1], e[2]) !== key), added: 0 };
  }
  return { entries: current, added: 0 };
}

export { parseCart };
