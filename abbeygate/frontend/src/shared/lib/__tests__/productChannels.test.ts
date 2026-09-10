/* @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest';
import { isAdminSession, isProductOnlineEntryAllowed, type ProductChannelMap } from '../productChannels';

afterEach(() => {
  window.localStorage.clear();
});

const MAP: ProductChannelMap = {
  travel: { questions: true, quote: true, payment: true },
  motor: { questions: true, quote: true, payment: false },
  home: { questions: false, quote: false, payment: false },
};

describe('productChannels (ADR-0046)', () => {
  describe('isAdminSession', () => {
    it('is false with no session', () => {
      expect(isAdminSession()).toBe(false);
    });

    it('is true for an internal (ADMIN) role', () => {
      window.localStorage.setItem('user_info', JSON.stringify({ name: 'A', role: 'ADMIN' }));
      expect(isAdminSession()).toBe(true);
    });

    it('is false for a CUSTOMER role', () => {
      window.localStorage.setItem('user_info', JSON.stringify({ name: 'C', role: 'CUSTOMER' }));
      expect(isAdminSession()).toBe(false);
    });
  });

  describe('isProductOnlineEntryAllowed', () => {
    it('allows everything for an admin (bypass)', () => {
      expect(isProductOnlineEntryAllowed(MAP, 'home', true)).toBe(true);
    });

    it('defaults to allowed while the map is still loading', () => {
      expect(isProductOnlineEntryAllowed(null, 'home', false)).toBe(true);
    });

    it('defaults to allowed for an unknown slug', () => {
      expect(isProductOnlineEntryAllowed(MAP, 'unknown', false)).toBe(true);
    });

    it('hides a product whose questions switch is OFF', () => {
      expect(isProductOnlineEntryAllowed(MAP, 'home', false)).toBe(false);
    });

    it('offers a product whose questions switch is ON (even if payment is OFF)', () => {
      expect(isProductOnlineEntryAllowed(MAP, 'motor', false)).toBe(true);
    });
  });
});
