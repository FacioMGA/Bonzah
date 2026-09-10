import { describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { assertPaymentTransitionAllowed, assertPolicyTransitionAllowed } from '../lifecycle/stateMachines.js';
import { selectQuoteReadyFieldKeys, validateManifestRequiredFields } from '../productFieldRequirements.js';
import { resolveClaimsContractFromProgram } from '../../../claims/domain/claimsContract.js';

registerAllProducts();

describe('multi-product platform completion guards', () => {
  it('derives quote-ready requirements from registered product manifests', () => {
    expect(selectQuoteReadyFieldKeys('MOTOR')).toEqual(expect.arrayContaining(['proposer.firstName', 'coverRequired', 'vehicleType']));
    expect(selectQuoteReadyFieldKeys('HOME')).toEqual(expect.arrayContaining(['proposer.firstName', 'property.propertyType', 'coverage.buildings']));
    expect(selectQuoteReadyFieldKeys('TRAVEL')).toEqual(expect.arrayContaining(['trip.planType', 'trip.startDate', 'quote.selectedPlan']));
  });

  it('validates issuance fields through the same manifest-driven path for home and travel', () => {
    const homeMissing = validateManifestRequiredFields('HOME', { proposer: { firstName: 'Ava' } }, 'ISSUED_POLICY_PACK');
    const travelMissing = validateManifestRequiredFields('TRAVEL', { proposer: { firstName: 'Ava' } }, 'ISSUED_POLICY_PACK');

    expect(homeMissing.map((field) => field.slug)).toEqual(expect.arrayContaining(['proposer.lastName', 'property.propertyType']));
    expect(travelMissing.map((field) => field.slug)).toEqual(expect.arrayContaining(['trip.planType', 'quote.selectedPlan']));
  });

  it('uses the same lifecycle engine regardless of product', () => {
    for (const productType of ['MOTOR', 'HOME', 'TRAVEL', 'HEALTH']) {
      expect(() => assertPolicyTransitionAllowed('DRAFT', 'QUOTED')).not.toThrow();
      expect(() => assertPolicyTransitionAllowed('QUOTED', 'BOUND')).not.toThrow();
      expect(() => assertPolicyTransitionAllowed('QUOTED', 'REFERRAL')).not.toThrow();
      expect(() => assertPolicyTransitionAllowed('AWAITING_PAYMENT', 'REFERRAL')).not.toThrow();
      expect(() => assertPolicyTransitionAllowed('ACTIVE', 'CANCELLATION_REQUESTED')).not.toThrow();
      expect(productType).toBeTruthy();
    }
  });

  it('accepts verified CardCorp terminal outcomes from a pending checkout', () => {
    expect(() => assertPaymentTransitionAllowed('PENDING', 'PAID')).not.toThrow();
    expect(() => assertPaymentTransitionAllowed('PENDING', 'FAILED')).not.toThrow();
    expect(() => assertPaymentTransitionAllowed('CANCELLED', 'PAID')).toThrow('Payment transition not allowed');
  });

  it('resolves product-owned claims defaults instead of motor defaults in shared code', () => {
    const motor = resolveClaimsContractFromProgram({ productType: 'MOTOR', programmeQuestionnaire: { claimsContract: { fnol: { incidentTypes: [{ id: 'collision', label: 'Collision' }] }, fullClaimForm: {} } } });
    const home = resolveClaimsContractFromProgram({ productType: 'HOME', programmeQuestionnaire: { claimsContract: { fnol: { incidentTypes: [{ id: 'escape_of_water', label: 'Escape of water' }] }, fullClaimForm: {} } } });
    const travel = resolveClaimsContractFromProgram({ productType: 'TRAVEL', programmeQuestionnaire: { claimsContract: { fnol: { incidentTypes: [{ id: 'medical', label: 'Medical' }] }, fullClaimForm: {} } } });

    expect(motor.fnol.incidentTypes.map((item) => item.id)).toContain('collision');
    expect(home.fnol.incidentTypes.map((item) => item.id)).toContain('escape_of_water');
    expect(travel.fnol.incidentTypes.map((item) => item.id)).toContain('medical');
  });
});
