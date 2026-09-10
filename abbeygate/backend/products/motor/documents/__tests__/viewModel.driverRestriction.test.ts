/**
 * Driver coverage restriction → certificate / statement wording
 * (ABY-232 / ADR-0025).
 *
 * The certificate's age-band and entitled-classes paragraph used to
 * be hard-coded to "between 25 and 70". After ABY-232 the wording
 * is dynamic per `driverRestriction`:
 *
 *   POLICYHOLDER_ONLY    → "The Policyholder only."
 *   NAMED_DRIVERS        → "The Policyholder and the Named Drivers …"
 *   ANY_DRIVER_25_PLUS   → "… any authorised driver aged between 25 and 70 …"
 *   ANY_DRIVER_40_PLUS   → "… any authorised driver aged between 40 and 70 …"
 *
 * Plus the statement-of-fact `statement.drivers` list now merges
 * named additional drivers when the policy is on the NAMED_DRIVERS
 * basis.
 */
import { describe, expect, it } from 'vitest';
import { buildMotorDocViewModel } from '../viewModel.js';
import { registerAllProducts } from '../../../registerProducts.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

registerAllProducts();

// ADR-0019: getTenantConfig() is ALS-only. Wrap every viewModel
// invocation in `runWithOperatingTenant` using the Cyprus fixture.
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

type DriverRestriction = 'POLICYHOLDER_ONLY' | 'NAMED_DRIVERS' | 'ANY_DRIVER_25_PLUS' | 'ANY_DRIVER_40_PLUS';

function buildVm(args: {
  driverRestriction?: DriverRestriction;
  additionalDrivers?: Array<Record<string, unknown>>;
}) {
  return runInCY(() => buildMotorDocViewModel({
    policy: {
      policyNumber: 'ABOLV1000001',
      inceptionDate: new Date('2026-03-01T00:00:00.000Z'),
      expiryDate: new Date('2027-03-01T00:00:00.000Z'),
      policyHolder: { name: 'Test User' },
      binder: { agreementNumber: 'ABBEYGATE0125' },
    },
    snap: {
      quoteData: {
        proposer: {
          firstName: 'Alice',
          lastName: 'Smith',
          dateOfBirth: '1985-01-01',
          address: { line1: 'Some street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
        },
        licenseType: 'Full',
        licenseYears: 12,
        driverRestriction: args.driverRestriction,
        additionalDrivers: args.additionalDrivers ?? [],
      },
      quoteResponse: { primaryOption: { costDetails: { subtotalNetPremium: 0, totalPremium: 0 } } },
    },
    activeEndorsements: [],
    appliedEndorsements: [],
    mbeSections: { coverages: [], conditions: [], assistance: null, premiumRows: [] },
    normalizedMbeCfg: {},
    greenCardSerial: null,
    brand: { brokerAddressMultiline: '' },
    assetsBasePath: 'file:///tmp',
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

describe('buildMotorDocViewModel — driverRestriction wording', () => {
  it('POLICYHOLDER_ONLY → "The Policyholder only." (no age band)', () => {
    const vm = buildVm({ driverRestriction: 'POLICYHOLDER_ONLY' });
    const drivers = asRecord(vm.drivers);
    expect(drivers.entitled_classes).toBe('The Policyholder only.');
    expect(drivers.age_band).toBe('—');
    expect(Array.isArray(drivers.named) ? (drivers.named as unknown[]).length : -1).toBe(0);
  });

  it('NAMED_DRIVERS → names the policyholder + the additional drivers in the certificate CSV', () => {
    const vm = buildVm({
      driverRestriction: 'NAMED_DRIVERS',
      additionalDrivers: [
        { firstName: 'Bob', lastName: 'Jones', dateOfBirth: '1990-02-15', licenseYears: 5 },
        { firstName: 'Carla', lastName: 'Reyes', dateOfBirth: '1988-07-04', licenseYears: 10 },
      ],
    });
    const drivers = asRecord(vm.drivers);
    expect(String(drivers.entitled_classes)).toContain('Named Drivers listed in this Certificate');
    expect(String(drivers.named_csv)).toContain('Alice Smith');
    expect(String(drivers.named_csv)).toContain('Bob Jones');
    expect(String(drivers.named_csv)).toContain('Carla Reyes');
    const named = drivers.named as Array<Record<string, unknown>>;
    expect(named).toHaveLength(2);
    expect(named[0]?.full_name).toBe('Bob Jones');
  });

  it('NAMED_DRIVERS statement.drivers includes the proposer plus each named driver row', () => {
    const vm = buildVm({
      driverRestriction: 'NAMED_DRIVERS',
      additionalDrivers: [
        { firstName: 'Bob', lastName: 'Jones', dateOfBirth: '1990-02-15', licenseYears: 5 },
      ],
    });
    const statement = asRecord(vm.statement);
    const drivers = (statement.drivers as Array<Record<string, unknown>>) || [];
    expect(drivers).toHaveLength(2);
    expect(drivers[0]?.relationship).toBe('Proposer');
    expect(drivers[1]?.relationship).toBe('Additional driver');
    expect(drivers[1]?.full_name).toBe('Bob Jones');
  });

  it('ANY_DRIVER_25_PLUS → ages 25–70 wording, no named drivers list', () => {
    const vm = buildVm({ driverRestriction: 'ANY_DRIVER_25_PLUS' });
    const drivers = asRecord(vm.drivers);
    expect(drivers.age_band).toBe('25 and 70');
    expect(String(drivers.entitled_classes)).toContain('aged between 25 and 70');
    expect((drivers.named as unknown[]).length).toBe(0);
  });

  it('ANY_DRIVER_40_PLUS → ages 40–70 wording, no named drivers list', () => {
    const vm = buildVm({ driverRestriction: 'ANY_DRIVER_40_PLUS' });
    const drivers = asRecord(vm.drivers);
    expect(drivers.age_band).toBe('40 and 70');
    expect(String(drivers.entitled_classes)).toContain('aged between 40 and 70');
    expect((drivers.named as unknown[]).length).toBe(0);
  });

  it('open modes ignore stale additionalDrivers — never surfaced in documents', () => {
    const vm = buildVm({
      driverRestriction: 'ANY_DRIVER_25_PLUS',
      additionalDrivers: [
        { firstName: 'Stale', lastName: 'Row', dateOfBirth: '1990-01-01', licenseYears: 5 },
      ],
    });
    const drivers = asRecord(vm.drivers);
    expect((drivers.named as unknown[]).length).toBe(0);
    const statement = asRecord(vm.statement);
    const statementDrivers = (statement.drivers as Array<Record<string, unknown>>) || [];
    // statement.drivers retains the proposer, but no additional rows
    expect(statementDrivers).toHaveLength(1);
    expect(statementDrivers[0]?.relationship).toBe('Proposer');
  });

  it('legacy quote (no driverRestriction) preserves historical "25 and 70" wording', () => {
    const vm = buildVm({});
    const drivers = asRecord(vm.drivers);
    expect(drivers.age_band).toBe('25 and 70');
  });
});
