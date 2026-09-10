import { describe, expect, it } from 'vitest';
import { presenterSafeRequest } from './demoApi';

describe('Bonzah presenter capture', () => {
  it('redacts policyholder details and payment tokens', () => {
    const capture = presenterSafeRequest(JSON.stringify({
      integrityToken: 'integrity-token',
      policyholder: { firstName: 'Alex', email: 'alex@example.test' },
      payment: { provider: 'SIMULATED', token: 'secret-token' },
      consents: { electronicDelivery: true },
    }));

    expect(capture).toMatchObject({
      integrityToken: 'integrity-token',
      policyholder: '[redacted customer details]',
      payment: '[redacted payment token]',
      consents: { electronicDelivery: true },
    });
    expect(JSON.stringify(capture)).not.toContain('alex@example.test');
    expect(JSON.stringify(capture)).not.toContain('secret-token');
  });
});
