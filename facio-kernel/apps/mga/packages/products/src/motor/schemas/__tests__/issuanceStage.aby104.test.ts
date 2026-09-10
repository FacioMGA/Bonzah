/**
 * ABY-104 — at issuance, registrationNumber OR vin is required (not
 * both). The earlier shape attached two different error messages —
 * one to each field — so the wizard rendered them as two independent
 * red banners that read like two independent requirements
 * ("validates on both"). The new shape attaches the SAME single
 * "either-or" message to BOTH fields so the user reads one
 * unambiguous instruction regardless of which field they look at,
 * and the wizard's QuoteWizardErrorSummary still highlights both
 * fields for them to act on.
 */
import { describe, expect, it } from 'vitest';
import { validateMotorBindStage, validateMotorIssuanceStage } from '../index';

describe('validateMotorBindStage — EV power contract (ADR-0102)', () => {
  it('fails closed when an electric vehicle has no manufacturer combined power', () => {
    const errors = validateMotorBindStage({ fuelType: 'Electric', electricPowerKw: null });
    expect(errors.electricPowerKw).toBe('Manufacturer maximum combined power (kW) is required for an electric vehicle');
  });

  it('accepts a supplied EV power value without creating a pricing default', () => {
    const errors = validateMotorBindStage({ fuelType: 'Electric', electricPowerKw: 160 });
    expect(errors.electricPowerKw).toBeUndefined();
  });
});

describe('validateMotorIssuanceStage — registration / VIN gate (ABY-104)', () => {
  it('errors on BOTH fields with the SAME either-or message when neither is provided', () => {
    const errors = validateMotorIssuanceStage({
      // registrationNumber + vin both empty/absent — minimum data
      // required for the stage gate to surface (other validators in
      // `validateMotorStageSemantics` may add more entries; we only
      // assert the registration/VIN behaviour here).
      registrationNumber: '',
      vin: '',
    });
    expect(errors.registrationNumber).toBe(
      'Provide either Registration number OR VIN — only one is required to issue.',
    );
    expect(errors.vin).toBe(errors.registrationNumber);
  });

  it('clears both errors when ONLY registrationNumber is provided', () => {
    const errors = validateMotorIssuanceStage({
      registrationNumber: 'ABC123',
      vin: '',
    });
    expect(errors.registrationNumber).toBeUndefined();
    expect(errors.vin).toBeUndefined();
  });

  it('clears both errors when ONLY vin is provided', () => {
    const errors = validateMotorIssuanceStage({
      registrationNumber: '',
      vin: 'WAUZZZ8V0LA123456',
    });
    expect(errors.registrationNumber).toBeUndefined();
    expect(errors.vin).toBeUndefined();
  });

  it('clears both errors when BOTH are provided (over-disclosure is fine)', () => {
    const errors = validateMotorIssuanceStage({
      registrationNumber: 'ABC123',
      vin: 'WAUZZZ8V0LA123456',
    });
    expect(errors.registrationNumber).toBeUndefined();
    expect(errors.vin).toBeUndefined();
  });
});
