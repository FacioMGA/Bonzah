import { describe, expect, it } from 'vitest';
import { toDocName } from './workspaceTableUtils';

describe('toDocName', () => {
  it('labels a Home schedule from the manifest, not a motor literal', () => {
    // Regression: a Home policy schedule previously rendered as
    // "Schedule of Motor Insurance" because of a hardcoded shared-BO branch.
    expect(toDocName('HOME_SCHEDULE_PDF')).toBe('Policy Schedule');
    expect(toDocName('home_schedule_pdf')).toBe('Policy Schedule');
  });

  it('labels motor documents from the motor manifest', () => {
    expect(toDocName('MOTOR_SCHEDULE_PDF')).toBe('Policy Schedule');
    expect(toDocName('MOTOR_CERTIFICATE_PDF')).toBe('Certificate of Insurance');
    expect(toDocName('MOTOR_GREEN_CARD_PDF')).toBe('Green Card');
  });

  it('labels other product documents from their manifest', () => {
    expect(toDocName('HOME_STATEMENT_OF_FACT_PDF')).toBe('Statement of Fact');
    expect(toDocName('TRAVEL_POLICY_WORDING_PDF')).toBe('Policy Wording');
  });

  it('humanises an unknown/non-product doc type instead of guessing a product', () => {
    expect(toDocName('KYC_UPLOAD')).toBe('Kyc Upload');
  });

  it('falls back to "Document" for empty input', () => {
    expect(toDocName('')).toBe('Document');
    expect(toDocName(null)).toBe('Document');
    expect(toDocName(undefined)).toBe('Document');
  });
});
