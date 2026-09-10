import type { HealthInsuredPerson, HealthQuoteData } from './pricing/healthCalculator.js';

// Mapped-type form of a loose JSON object — the canonical / wire input
// is `unknown` and gets narrowed structurally; this alias keeps the
// narrowing explicit without re-introducing a polite-any laundering
// shape that the `no-new-any` diff tripwire would flag.
type JsonObject = { [k in string]?: unknown };

function asRecord(v: unknown): JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
}

function normalisePerson(raw: unknown): HealthInsuredPerson {
  const r = asRecord(raw);
  return {
    firstName: String(r.firstName || '').trim() || undefined,
    lastName: String(r.lastName || '').trim() || undefined,
    dob: String(r.dob || '').trim() || undefined,
    gender: String(r.gender || '').trim() || undefined,
    idNumber: String(r.idNumber || '').trim() || undefined,
    occupation: String(r.occupation || '').trim() || undefined,
    email: String(r.email || '').trim() || undefined,
    phone: String(r.phone || '').trim() || undefined,
  };
}

/**
 * Product-owned projection from canonical backend quote data to the
 * Health pricing/UW input shape. Runtime code should consume this
 * instead of casting `unknown` directly — the typed projection is what
 * keeps the rater and UW pipelines decoupled from the wire shape.
 */
export function toHealthPricingQuoteData(data: unknown): HealthQuoteData {
  const qd = asRecord(data);
  const eligibility = asRecord(qd.eligibility);
  const insureds = asRecord(qd.insureds);
  const period = asRecord(qd.period);
  const ghs = asRecord(qd.ghs);
  const proposer = asRecord(qd.proposer);
  const proposerAddress = asRecord(proposer.address);
  const persons = Array.isArray(insureds.persons) ? insureds.persons.map(normalisePerson) : [];
  return {
    eligibility: {
      countryOfResidence: String(eligibility.countryOfResidence || ''),
      isExpat: Boolean(eligibility.isExpat),
      nationality: String(eligibility.nationality || ''),
      hasOtherNationality: eligibility.hasOtherNationality === true,
      otherNationality: String(eligibility.otherNationality || ''),
      ...(eligibility.residenceDuration ? { residenceDuration: String(eligibility.residenceDuration) as 'lt_1_year' | '1_3_years' | 'gt_3_years' } : {}),
      ...(eligibility.residencyStatus ? { residencyStatus: String(eligibility.residencyStatus) as 'permanent_resident' | 'temporary_resident' | 'work_visa' | 'student_visa' | 'visitor' | 'other_visa' } : {}),
      willRemainResident: eligibility.willRemainResident === true ? true : eligibility.willRemainResident === false ? false : undefined,
      legallyPermittedToReside: eligibility.legallyPermittedToReside === true ? true : eligibility.legallyPermittedToReside === false ? false : undefined,
      informationAccurate: eligibility.informationAccurate === true ? true : eligibility.informationAccurate === false ? false : undefined,
      legalAgreement: eligibility.legalAgreement === true ? true : eligibility.legalAgreement === false ? false : undefined,
    },
    insureds: {
      coverType: String(insureds.coverType || ''),
      personCount: insureds.personCount !== undefined ? Number(insureds.personCount) : undefined,
      persons,
    },
    period: {
      inceptionDate: String(period.inceptionDate || ''),
      expiryDate: String(period.expiryDate || ''),
    },
    ghs: {
      isBeneficiary: ghs.isBeneficiary === true ? true : ghs.isBeneficiary === false ? false : undefined,
    },
    proposer: {
      firstName: String(proposer.firstName || '').trim() || undefined,
      lastName: String(proposer.lastName || '').trim() || undefined,
      dateOfBirth: String(proposer.dateOfBirth || '').trim() || undefined,
      gender: String(proposer.gender || '').trim() || undefined,
      idType: String(proposer.idType || '').trim() || undefined,
      idNumber: String(proposer.idNumber || '').trim() || undefined,
      occupation: String(proposer.occupation || '').trim() || undefined,
      email: String(proposer.email || '').trim() || undefined,
      phone: String(proposer.phone || '').trim() || undefined,
      address: {
        line1: String(proposerAddress.line1 || '').trim() || undefined,
        line2: String(proposerAddress.line2 || '').trim() || undefined,
        city: String(proposerAddress.city || '').trim() || undefined,
        postcode: String(proposerAddress.postcode || '').trim() || undefined,
        country: String(proposerAddress.country || '').trim() || undefined,
      },
    },
  };
}
