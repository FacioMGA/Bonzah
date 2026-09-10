import { describe, expect, it } from 'vitest';
import { legacyRentalEntryLocation } from './router';

describe('rental public entry alias', () => {
  it('preserves partner query parameters when redirecting the legacy route', () => {
    expect(legacyRentalEntryLocation('?workspace=synthetic-us-rental&source=sixt')).toEqual({
      pathname: '/quote/rental-car/new',
      search: '?workspace=synthetic-us-rental&source=sixt',
    });
  });
});
