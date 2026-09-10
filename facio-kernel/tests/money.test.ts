import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currencyExponents,
  financialAllocationInputSchema,
  financialAllocationResultSchema,
  minorUnitSchema,
  type FinancialAllocationInput,
} from '../src/contracts/money.js';
import { allocateFinancials } from '../src/domain/money.js';
import { KernelError } from '../src/domain/canonical.js';

const input = (premiumMinor = '50000000'): FinancialAllocationInput => ({
  currency: 'GBP',
  premiumMinor,
  participants: [
    { id: 'lead', role: 'lead', shareBps: 5000 },
    { id: 'follower_a', role: 'follow', shareBps: 1000 },
    { id: 'follower_b', role: 'follow', shareBps: 1500 },
    { id: 'follower_c', role: 'follow', shareBps: 2500 },
  ],
  commission: {
    rateBps: 750,
    base: 'gross_premium',
    recipientId: 'commission_recipient',
    settlementPartyId: 'settlement_party',
    cashCustody: 'external',
  },
});
const amounts = (value: ReturnType<typeof allocateFinancials>) =>
  Object.fromEntries(
    value.allocations.map((allocation) => [allocation.participantId, allocation.premiumMinor]),
  );

test('source illustrative premium and MTA allocate exactly without assuming client-money custody', () => {
  const original = input();
  const before = structuredClone(original);
  const result = allocateFinancials(original);
  assert.deepEqual(amounts(result), {
    follower_a: '5000000',
    follower_b: '7500000',
    follower_c: '12500000',
    lead: '25000000',
  });
  assert.equal(result.commission.amountMinor, '3750000');
  assert.equal(result.commission.cashCustody, 'external');
  assert.equal(result.commission.recipientId, original.commission.recipientId);
  assert.equal(result.commission.settlementPartyId, original.commission.settlementPartyId);
  assert.deepEqual(original, before);
  assert.deepEqual(financialAllocationResultSchema.parse(result), result);
  const delta = allocateFinancials(input('10000000'));
  assert.deepEqual(amounts(delta), {
    follower_a: '1000000',
    follower_b: '1500000',
    follower_c: '2500000',
    lead: '5000000',
  });
  assert.equal(delta.commission.amountMinor, '750000');
  assert.equal(allocateFinancials(input('60000000')).commission.amountMinor, '4500000');
});

test('largest remainder conserves every minor unit, breaks ties by ID and ignores participant order', () => {
  const request = input('1');
  request.participants = [
    { id: 'z_lead', role: 'lead', shareBps: 5000 },
    { id: 'a_follow', role: 'follow', shareBps: 5000 },
  ];
  const result = allocateFinancials(request);
  assert.deepEqual(amounts(result), { a_follow: '1', z_lead: '0' });
  assert.deepEqual(
    allocateFinancials({ ...request, participants: [...request.participants].reverse() }),
    result,
  );
  request.participants = [
    { id: 'a_lead', role: 'lead', shareBps: 1000 },
    { id: 'z_follow', role: 'follow', shareBps: 9000 },
  ];
  assert.deepEqual(amounts(allocateFinancials(request)), { a_lead: '0', z_follow: '1' });
});

test('signed adjustments are exact mirrors and conserve totals across residual boundaries', () => {
  for (const magnitude of [
    '0',
    '1',
    '2',
    '3',
    '7',
    '11',
    '9999',
    '10000',
    '10000000',
    '9007199254740993',
    '999999999999999999',
  ]) {
    const positive = allocateFinancials(input(magnitude));
    const negative = allocateFinancials(input(magnitude === '0' ? '0' : '-' + magnitude));
    assert.equal(
      positive.allocations.reduce((sum, allocation) => sum + BigInt(allocation.premiumMinor), 0n),
      BigInt(magnitude),
    );
    assert.equal(
      negative.allocations.reduce((sum, allocation) => sum + BigInt(allocation.premiumMinor), 0n),
      -BigInt(magnitude),
    );
    positive.allocations.forEach((allocation, index) => {
      assert.equal(
        negative.allocations[index]!.premiumMinor,
        (-BigInt(allocation.premiumMinor)).toString(),
      );
    });
    assert.equal(
      negative.commission.amountMinor,
      (-BigInt(positive.commission.amountMinor)).toString(),
    );
    assert.ok(financialAllocationResultSchema.safeParse(negative).success);
  }
});

test('commission rounds half away from zero using exact integers', () => {
  for (const [premiumMinor, rateBps, expected] of [
    ['1', 4999, '0'],
    ['1', 5000, '1'],
    ['1', 5001, '1'],
    ['-1', 4999, '0'],
    ['-1', 5000, '-1'],
    ['-1', 5001, '-1'],
    ['3', 5000, '2'],
    ['-3', 5000, '-2'],
    ['10', 0, '0'],
    ['10', 10000, '10'],
  ] as const) {
    const request = input(premiumMinor);
    request.commission.rateBps = rateBps;
    assert.equal(allocateFinancials(request).commission.amountMinor, expected);
  }
});

test('supported currency exponents are explicit and amounts remain in original minor units', () => {
  assert.deepEqual(currencyExponents, { GBP: 2, USD: 2, EUR: 2, JPY: 0, KWD: 3 });
  for (const currency of ['GBP', 'USD', 'EUR', 'JPY', 'KWD'] as const) {
    const result = allocateFinancials({ ...input('10000'), currency });
    assert.equal(result.currency, currency);
    assert.equal(result.premiumMinor, '10000');
    assert.equal(result.commission.amountMinor, '750');
    assert.equal(
      result.allocations.reduce((sum, allocation) => sum + BigInt(allocation.premiumMinor), 0n),
      10000n,
    );
  }
});

test('amounts above the JS safe-integer limit retain all digits', () => {
  const request = input('9007199254740993');
  request.participants = [{ id: 'only_lead', role: 'lead', shareBps: 10000 }];
  request.commission.rateBps = 10000;
  const result = allocateFinancials(request);
  assert.equal(result.allocations[0]!.premiumMinor, '9007199254740993');
  assert.equal(result.commission.amountMinor, '9007199254740993');
});

test('invalid currencies, noncanonical or overflowing money and coercions are rejected', () => {
  const invalidAmounts: unknown[] = [
    '',
    '-0',
    '00',
    '01',
    '-01',
    '+1',
    '1.00',
    '.5',
    '1e3',
    ' 1',
    '1 ',
    '1\n',
    '0\r\n',
    '1000000000000000000',
    '-1000000000000000000',
    1,
    9007199254740993,
    null,
  ];
  for (const premiumMinor of invalidAmounts) {
    assert.equal(minorUnitSchema.safeParse(premiumMinor).success, false);
    assertInvalid({ ...input(), premiumMinor });
  }
  for (const currency of ['AUD', 'gbp', '', null]) assertInvalid({ ...input(), currency });
  assert.equal(minorUnitSchema.safeParse('999999999999999999').success, true);
  assert.equal(minorUnitSchema.safeParse('-999999999999999999').success, true);
});

test('participation, commission and explicit settlement boundary fail closed', () => {
  const base = input();
  for (const shareBps of [0, -1, 0.5, 10001, NaN, Infinity, '5000'])
    assertInvalid({ ...base, participants: [{ ...base.participants[0], shareBps }] });
  assertInvalid({ ...base, participants: [] });
  assertInvalid({ ...base, participants: [{ id: 'only', role: 'follow', shareBps: 10000 }] });
  assertInvalid({
    ...base,
    participants: [
      { id: 'first', role: 'lead', shareBps: 5000 },
      { id: 'second', role: 'lead', shareBps: 5000 },
    ],
  });
  assertInvalid({
    ...base,
    participants: [
      { id: 'same', role: 'lead', shareBps: 5000 },
      { id: 'same', role: 'follow', shareBps: 5000 },
    ],
  });
  assertInvalid({ ...base, participants: [{ id: 'lead', role: 'lead', shareBps: 9999 }] });
  assertInvalid({ ...base, participants: [{ id: 'lead\n', role: 'lead', shareBps: 10000 }] });
  for (const rateBps of [-1, 10001, 750.5, NaN, Infinity, '750'])
    assertInvalid({ ...base, commission: { ...base.commission, rateBps } });
  for (const commission of [
    undefined,
    { ...base.commission, recipientId: '' },
    { ...base.commission, settlementPartyId: '' },
    { ...base.commission, cashCustody: 'internal' },
    { ...base.commission, base: 'net_premium' },
  ])
    assertInvalid({ ...base, commission });
  assertInvalid({ ...base, extraInput: true });
  assertInvalid({ ...base, commission: { ...base.commission, extraInput: true } });
});

function assertInvalid(value: unknown): void {
  assert.equal(financialAllocationInputSchema.safeParse(value).success, false);
  assert.throws(
    () => allocateFinancials(value as FinancialAllocationInput),
    (error: unknown) => {
      assert.ok(error instanceof KernelError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'INVALID_FINANCIAL_ALLOCATION');
      return true;
    },
  );
}
