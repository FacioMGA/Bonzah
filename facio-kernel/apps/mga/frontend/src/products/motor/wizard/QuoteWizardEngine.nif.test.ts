import { describe, expect, it } from 'vitest';
import {
  motorPreQuoteJointProposerFields,
  motorPreQuotePolicyHolderFields,
} from './QuoteWizardEngine';

describe('Motor public journey NIF collection', () => {
  it('defers NIF for both pre-quote proposer forms', () => {
    expect(motorPreQuotePolicyHolderFields.nif).toBe(false);
    expect(motorPreQuoteJointProposerFields.nif).toBe(false);
  });
});
