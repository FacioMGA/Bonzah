/**
 * Rule registry factories.
 *
 * `createRuleRegistry({ phoneValidator })` builds the `Record<ref, schema>`
 * lookup map that `resolveRule` consults. The phone validator is injected
 * so the same registry layout works for both adapters; everything else is
 * pure.
 *
 * `createResolveRule(registry)` returns the per-context `resolveRule`
 * function. It supports parameterised refs (`postcode:portugal`,
 * `dob:18-85`, `oneOf:Foo|Bar`) by stripping the `:` suffix and dispatching
 * to the matching factory.
 *
 * Unknown refs fall back to a permissive `z.unknown()`. We do NOT log a
 * warn here — `@facio/validation` is environment-isolated (see
 * tools/quality/check-validation-purity.mjs) and cannot import a
 * logger. If unknown refs prove to be a real source of typos, add a
 * static CI guard that scans profiles for refs not present in the
 * registry; do not introduce runtime logging.
 */

import { z, type ZodTypeAny } from 'zod';

import {
  Name,
  Email,
  IsoDate,
  DOB,
  PositiveMoney,
  NonNegativeMoney,
  Percentage,
  CountryName,
  Nif,
  MustAccept,
  BoolFlag,
  NonEmptyString,
  NonEmptyStringArray,
  PostcodeForCountry,
  OneOf,
} from './rules-pure.js';
import { nationalityRule } from './nationality/contract.js';
import { createPhoneE164, type PhoneValidator } from './rules-phone.js';

export type RuleRegistry = Record<string, ZodTypeAny | ((arg?: unknown) => ZodTypeAny)>;

/**
 * Build the rule registry for a specific environment.
 *
 * The only env-specific entry is `phoneE164`, which is constructed from
 * the injected `phoneValidator`. Everything else is shared.
 */
export function createRuleRegistry(deps: { phoneValidator: PhoneValidator }): RuleRegistry {
  const phoneE164 = createPhoneE164({ phoneValidator: deps.phoneValidator });
  return {
    name: Name,
    email: Email,
    phoneE164,
    dob: DOB(),
    'dob:18-85': DOB({ minAge: 18, maxAge: 85 }),
    'dob:18-100': DOB({ minAge: 18, maxAge: 100 }),
    isoDate: IsoDate,
    positiveMoney: PositiveMoney,
    nonNegativeMoney: NonNegativeMoney,
    percentage: Percentage,
    countryName: CountryName,
    nationality: nationalityRule,
    nif: Nif,
    mustAccept: MustAccept,
    bool: BoolFlag,
    nonEmptyString: NonEmptyString(),
    nonEmptyStringArray: NonEmptyStringArray,
  };
}

/**
 * Build the per-context `resolveRule(ref)` function. Returns a closure
 * over the supplied registry so the rest of the runtime never has to know
 * about phone validators or anything env-specific.
 */
export function createResolveRule(registry: RuleRegistry): (ref: string) => ZodTypeAny {
  return function resolveRule(ref: string): ZodTypeAny {
    if (!ref) return z.unknown();
    const colonIdx = ref.indexOf(':');
    const name = colonIdx === -1 ? ref : ref.slice(0, colonIdx);
    const arg = colonIdx === -1 ? undefined : ref.slice(colonIdx + 1);
    if (name === 'postcode') return PostcodeForCountry(arg);
    if (name === 'oneOf' && arg) return OneOf(arg.split('|'));
    if (name === 'dob' && arg) {
      const [minStr, maxStr] = arg.split('-');
      const minAge = Number(minStr);
      const maxAge = Number(maxStr);
      if (Number.isFinite(minAge) && Number.isFinite(maxAge)) return DOB({ minAge, maxAge });
    }
    const direct = registry[ref];
    if (direct) return typeof direct === 'function' ? (direct as () => ZodTypeAny)() : direct;
    const base = registry[name];
    if (base) return typeof base === 'function' ? (base as (a?: unknown) => ZodTypeAny)(arg) : base;
    return z.unknown();
  };
}
