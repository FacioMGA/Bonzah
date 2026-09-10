import { describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../../products/registerProducts.js';
import { customerContactFromQuoteData } from '../../../../policy/app/customerAccountMaterialization.js';
import { validateDraftQuote } from '../../../../quotes/app/validator.js';
import { resolveJurisdictionProductConfig } from '../../../../jurisdiction/domain/productConfiguration.js';
import { buildQuoteDataFromDto, mapRawRowToDto } from '../mapper.js';
import { evaluateBdxMigrationRows } from '../service.js';
import type { BdxRawRow } from '../types.js';

registerAllProducts();

const sources: Array<[string, (value: unknown) => BdxRawRow]> = [
  ['email', (email) => ({ email })],
  ['Email', (Email) => ({ Email })],
  ['eMail', (eMail) => ({ eMail })],
  ['proposer.email column', (email) => ({ 'proposer.email': email })],
  ['proposer.email object', (email) => ({ proposer: { email } })],
  ['productData.email', (email) => ({ productData: { email } })],
  ['productData.proposer.email', (email) => ({ productData: { proposer: { email } } })],
];

describe.each(['home', 'travel'] as const)('%s BDX contact identity', (productLine) => {
  const productType = productLine === 'home' ? 'HOME' : 'TRAVEL';
  const config = resolveJurisdictionProductConfig({ productCode: productType, source: { countryCode: 'CY' } });
  const fixture = (contact: BdxRawRow = {}, certificate = 'CONTACT-001'): BdxRawRow => ({
    __productLine: productLine,
    'Certificate Ref': certificate,
    'Risk, Transaction Type': 'NB',
    'Insured First Name': 'Alice',
    'Insured Full Name, Last Name or Company Name': 'Example',
    'Insured Country (see code list)': 'Cyprus',
    'Insured Address': '10 Example Street',
    'Insured Town, City, Suburb, Place': 'Nicosia',
    'Policy Holder Town / City': 'Nicosia',
    'Risk Inception Date': '2030-01-01',
    'Risk Expiry Date': '2031-01-01',
    'Total gross written premium': 100,
    'Coverholder commission amount for whole risk/written premium': 20,
    'Net written Premium to London in original currency': 80,
    'Buildings Sum Insured': 150000,
    'No Of Beds': 3,
    'Property Type': 'Villa',
    'Level of Cover': 'Gold',
    'Area of Cover': 'Europe',
    'Type of Cover': 'Multi Trip',
    'Number of Days': 31,
    Travellers: 'Individual',
    'Traveller 1 DOB': '1980-01-01',
    ...contact,
  });
  const map = (row: BdxRawRow, rowNumber = 2) => mapRawRowToDto(row, rowNumber, config);
  const emailOf = (row: BdxRawRow) => (map(row).productData?.proposer as { email: unknown }).email;
  const emailIssues = (row: BdxRawRow) => validateDraftQuote({
    quoteData: buildQuoteDataFromDto(map(row), config),
    productType,
    mode: 'issuance',
  }).schemaIssues.filter((issue) => issue.path === 'proposer.email');

  it.each(sources)('imports an explicitly supplied %s through to customer contact', (_name, source) => {
    const row = fixture(source('  Alice.Example+Renewal@EXAMPLE.COM  '));
    const original = structuredClone(row);
    const dto = map(row);
    const quoteData = buildQuoteDataFromDto(dto, config);

    expect(customerContactFromQuoteData(quoteData)).toMatchObject({
      firstName: 'Alice', lastName: 'Example', email: 'alice.example+renewal@example.com',
    });
    expect(emailIssues(row)).toEqual([]);
    expect(dto.policyRef).toBe('CONTACT-001');
    expect(row).toEqual(original);
  });

  it.each([undefined, null, '', '   '])('keeps per-certificate placeholders when supplied email is %j', (email) => {
    const first = fixture({ email }, 'CONTACT-001');
    const second = fixture({ email }, 'CONTACT-002');
    expect(emailOf(first)).toBe('contact001@import.local');
    expect(emailOf(second)).toBe('contact002@import.local');
    expect(emailIssues(first)).toEqual([]);
  });

  it('does not infer an address from names, broker contact, or another traveller', () => {
    expect(emailOf(fixture({
      'Broker Email': 'broker@example.com',
      'Traveller 2 Email': 'other@example.com',
    }))).toBe('contact001@import.local');
  });

  it('allows matching aliases after normalization and preserves distinct plus-tag identities', () => {
    expect(emailOf(fixture({
      Email: ' ALICE@EXAMPLE.COM ',
      proposer: { email: 'alice@example.com' },
      productData: { proposer: { email: 'Alice@Example.com' } },
    }))).toBe('alice@example.com');
    expect(emailOf(fixture({ email: 'alice+home@example.com' })))
      .not.toBe(emailOf(fixture({ email: 'alice+travel@example.com' })));
    expect(emailOf(fixture({ email: 'a.lice@example.com' })))
      .not.toBe(emailOf(fixture({ email: 'alice@example.com' })));
  });

  it.each(sources)('leaves malformed %s visible to canonical validation', (_name, source) => {
    const row = fixture(source('not-an-email'));
    expect(emailOf(row)).toBe('not-an-email');
    expect(emailIssues(row)).toEqual([expect.objectContaining({ message: expect.stringMatching(/valid email/i) })]);
  });

  it.each([123, false, ['alice@example.com'], { email: 'alice@example.com' }])('rejects a non-string email %j without coercing it into an identity', (email) => {
    const row = fixture({ email });
    expect(emailOf(row)).toEqual(email);
    expect(emailIssues(row)).not.toEqual([]);
  });

  it.each([
    { email: 'alice@example.com', Email: 'bob@example.com' },
    { email: 'alice@example.com', proposer: { email: 'bob@example.com' } },
    { email: 'alice@example.com', productData: { proposer: { email: 'not-an-email' } } },
  ])('rejects conflicting supplied contact identities: %j', (contact) => {
    expect(emailIssues(fixture(contact))).not.toEqual([]);
  });

  it.each([
    { email: 'not-an-email' },
    { email: ['alice@example.com'] },
    { Email: 'alice@example.com', proposer: { email: 'bob@example.com' } },
  ])('reports a Critical import gap and retains the source row for invalid contact: %j', async (contact) => {
    const row = fixture(contact);
    const original = structuredClone(row);
    const [result] = await evaluateBdxMigrationRows({
      rows: [row],
      request: { sourceFilePath: 'contact-fixture.csv', dryRun: true, productLine },
      program: { id: 'contact-fixture', metadata: {} },
    });
    expect(result.result).toBe('FAIL');
    expect(result.rawRow).toEqual(original);
    expect(result.gaps).toContainEqual(expect.objectContaining({
      severity: 'Critical',
      rootCauseHint: expect.stringContaining('proposer.email'),
    }));
  });
});
