import { describe, expect, it, vi } from 'vitest';
import {
  buildCheckoutForm,
  checkoutSignature,
  cleanText,
  confirmWithPayFast,
  ipInRange,
  isPayFastIp,
  itnParamString,
  normaliseIp,
  parseItnBody,
  payfastCellNumber,
  phpUrlencode,
  resetPayFastIpCache,
  verifyItnSignature,
  type Pair,
} from '../../src/lib/payfast';
import { PAYFAST_SANDBOX, type PayFastConfig } from '../../src/lib/config';

const sandbox: PayFastConfig = { host: 'sandbox.payfast.co.za', ...PAYFAST_SANDBOX };

// Expected signatures were computed independently in Python
// (urllib.parse.quote_plus with PHP's ~ handling + hashlib.md5), not with this module.
const CHECKOUT_FIELDS: Pair[] = [
  ['merchant_id', '10000100'],
  ['merchant_key', '46f0cd694581a'],
  ['return_url', 'https://bigjos.example/order/BJ-261006-ABCD?t=tok_123'],
  ['cancel_url', 'https://bigjos.example/checkout/cancelled?item=set&finish=flax&qty=1'],
  ['notify_url', 'https://bigjos.example/api/payfast/itn'],
  ['name_first', 'Thabo'],
  ['name_last', 'O’Brien'],
  ['email_address', 'thabo@example.com'],
  ['cell_number', '0821234567'],
  ['m_payment_id', 'BJ-261006-ABCD'],
  ['amount', '24999.00'],
  ['item_name', 'Big Jo’s Beds Mattress and matching base, Flax'],
  ['item_description', '160 x 210 cm, Flax finish. Quantity 1.'],
  ['custom_int1', '1'],
  ['custom_str1', 'flax'],
  ['custom_str2', 'set'],
];
const CHECKOUT_SIGNATURE = '4b7fba7f4f0237ab346527422db4043f';

const ITN_BODY =
  'm_payment_id=BJ-261006-ABCD&pf_payment_id=1089250&payment_status=COMPLETE' +
  '&item_name=Big+Jo%E2%80%99s+Beds+Mattress+and+matching+base%2C+Flax&item_description=' +
  '&amount_gross=24999.00&amount_fee=-575.98&amount_net=24423.02&custom_str1=flax&name_first=Thabo' +
  '&name_last=O%E2%80%99Brien&email_address=thabo%40example.com&merchant_id=10000100' +
  '&signature=7f2ecc7e08c572bccef02f6b544a9b5a';

describe('phpUrlencode', () => {
  it.each([
    ['a b', 'a+b'],
    ["O'Brien", 'O%27Brien'],
    ['~!*()', '%7E%21%2A%28%29'],
    ['https://x.example/a?b=1&c=2', 'https%3A%2F%2Fx.example%2Fa%3Fb%3D1%26c%3D2'],
    ['Jo’s', 'Jo%E2%80%99s'],
    ['-_.', '-_.'],
  ])('%s → %s', (input, expected) => expect(phpUrlencode(input)).toBe(expected));
});

describe('checkout signature', () => {
  it('matches the independent reference implementation', () => {
    expect(checkoutSignature(CHECKOUT_FIELDS, PAYFAST_SANDBOX.passphrase)).toBe(CHECKOUT_SIGNATURE);
  });

  it('ignores blank fields, as PayFast does', () => {
    const withBlank: Pair[] = [...CHECKOUT_FIELDS.slice(0, 5), ['fica_idnumber', ''], ...CHECKOUT_FIELDS.slice(5)];
    expect(checkoutSignature(withBlank, PAYFAST_SANDBOX.passphrase)).toBe(CHECKOUT_SIGNATURE);
  });

  it('changes when the amount changes', () => {
    const tampered = CHECKOUT_FIELDS.map(([k, v]) => [k, k === 'amount' ? '1.00' : v] as Pair);
    expect(checkoutSignature(tampered, PAYFAST_SANDBOX.passphrase)).not.toBe(CHECKOUT_SIGNATURE);
  });
});

describe('buildCheckoutForm', () => {
  const form = buildCheckoutForm(
    {
      reference: 'BJ-261006-ABCD',
      amount: '24999.00',
      itemName: "Big Jo's Beds Mattress and matching base, Flax",
      itemDescription: '160 x 210 cm, Flax finish. Quantity 1.',
      firstName: ' Thabo ',
      lastName: "O'Brien",
      email: 'thabo@example.com',
      cellNumber: '+27 82 123 4567',
      returnUrl: 'https://bigjos.example/order/BJ-261006-ABCD?t=tok_123',
      cancelUrl: 'https://bigjos.example/checkout/cancelled?item=set&finish=flax&qty=1',
      notifyUrl: 'https://bigjos.example/api/payfast/itn',
      customInt1: 1,
      customStr1: 'flax',
      customStr2: 'set',
    },
    sandbox,
  );

  it('posts to the sandbox process URL', () => {
    expect(form.action).toBe('https://sandbox.payfast.co.za/eng/process');
  });

  it('produces the reference fields in PayFast order with the reference signature last', () => {
    expect(form.fields.slice(0, -1)).toEqual(CHECKOUT_FIELDS);
    expect(form.fields.at(-1)).toEqual(['signature', CHECKOUT_SIGNATURE]);
  });

  it('omits blank optional fields entirely', () => {
    const minimal = buildCheckoutForm(
      {
        reference: 'R1',
        amount: '1.00',
        itemName: 'x',
        itemDescription: '',
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.co',
        cellNumber: 'not a number',
        returnUrl: 'https://s/r',
        cancelUrl: 'https://s/c',
        notifyUrl: 'https://s/n',
      },
      sandbox,
    );
    const names = minimal.fields.map(([k]) => k);
    expect(names).not.toContain('cell_number');
    expect(names).not.toContain('item_description');
    expect(names).not.toContain('custom_int1');
  });
});

describe('cleanText and payfastCellNumber', () => {
  it('normalises free text', () => {
    expect(cleanText("  Big   Jo's (test)!\n", 100)).toBe('Big Jo’s test');
    expect(cleanText('x'.repeat(150), 100)).toHaveLength(100);
  });

  it.each([
    ['082 123 4567', '0821234567'],
    ['+27 82 123 4567', '0821234567'],
    ['27821234567', '0821234567'],
    ['021 180 4767', null], // landline
    ['12345', null],
    [null, null],
  ])('%s → %s', (input, expected) => expect(payfastCellNumber(input)).toBe(expected));
});

describe('ITN signature', () => {
  const pairs = parseItnBody(ITN_BODY);

  it('builds the parameter string with blank fields and without the signature', () => {
    const s = itnParamString(pairs);
    expect(s).toContain('item_description=&');
    expect(s).not.toContain('signature');
    expect(s.endsWith('merchant_id=10000100')).toBe(true);
  });

  it('accepts the reference vector', () => {
    expect(verifyItnSignature(pairs, PAYFAST_SANDBOX.passphrase)).toBe(true);
  });

  it('rejects a tampered amount, a wrong passphrase and a missing signature', () => {
    expect(verifyItnSignature(parseItnBody(ITN_BODY.replace('24999.00', '1.00')), PAYFAST_SANDBOX.passphrase)).toBe(false);
    expect(verifyItnSignature(pairs, 'wrong')).toBe(false);
    expect(verifyItnSignature(pairs.filter(([k]) => k !== 'signature'), PAYFAST_SANDBOX.passphrase)).toBe(false);
  });
});

describe('PayFast source IP', () => {
  it('matches the published ranges', () => {
    expect(ipInRange('197.97.145.150', '197.97.145.144/28')).toBe(true);
    expect(ipInRange('197.97.145.160', '197.97.145.144/28')).toBe(false);
    expect(ipInRange('41.74.179.223', '41.74.179.192/27')).toBe(true);
    expect(ipInRange('not.an.ip', '41.74.179.192/27')).toBe(false);
    expect(normaliseIp('::ffff:102.216.36.5')).toBe('102.216.36.5');
  });

  it('accepts range and DNS addresses and rejects others', async () => {
    resetPayFastIpCache();
    const resolver = vi.fn(async (host: string) => (host === 'www.payfast.co.za' ? ['203.0.113.7'] : []));
    expect(await isPayFastIp('102.216.36.140', resolver)).toBe(true);
    expect(await isPayFastIp('203.0.113.7', resolver)).toBe(true);
    expect(await isPayFastIp('127.0.0.1', resolver)).toBe(false);
    resetPayFastIpCache();
  });
});

describe('server confirmation', () => {
  const reply = (body: string, status = 200) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

  it('posts the parameter string to the validate endpoint', async () => {
    const fetchImpl = reply('VALID');
    expect(await confirmWithPayFast('a=1', 'sandbox.payfast.co.za', fetchImpl)).toBe('valid');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://sandbox.payfast.co.za/eng/query/validate',
      expect.objectContaining({ method: 'POST', body: 'a=1' }),
    );
  });

  it('distinguishes INVALID from a failed request', async () => {
    expect(await confirmWithPayFast('a=1', 'www.payfast.co.za', reply('INVALID'))).toBe('invalid');
    expect(await confirmWithPayFast('a=1', 'www.payfast.co.za', reply('oops', 500))).toBe('error');
    const throwing = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await confirmWithPayFast('a=1', 'www.payfast.co.za', throwing)).toBe('error');
  });
});
