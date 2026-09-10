import { test, expect, describe, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { WebhookDispatcher } from '../webhookDispatcher.js';

const safePostJsonMock = vi.fn();
vi.mock('../../../../../platform/http/safeHttpClient.js', () => ({
    safePostJson: (...args: unknown[]) => safePostJsonMock(...args),
}));

describe('WebhookDispatcher Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        safePostJsonMock.mockResolvedValue(new Response('OK', { status: 200 }));
    });

    test('should dispatch webhook with correct HMAC signature', async () => {
        const mockSecret = 'whsec_crypto_test_12345';
        const mockPayload = { claimId: 'claim-123', status: 'OPEN' };
        const endpoints = [{ url: 'https://thirdparty.example.com/webhook', secret: mockSecret }];

        // Execute dispatch
        await WebhookDispatcher.dispatch(endpoints, 'claim.created', mockPayload);

        // Verification: webhook transport called exactly once
        expect(safePostJsonMock).toHaveBeenCalledTimes(1);

        const [url, headers, bodyContent] = safePostJsonMock.mock.calls[0];
        expect(url).toBe('https://thirdparty.example.com/webhook');

        // Parse the body that was sent
        const parsedBody = JSON.parse(String(bodyContent || ''));

        expect(parsedBody.eventType).toBe('claim.created');
        expect(parsedBody.data).toEqual(mockPayload);
        expect(parsedBody.eventId).toBeDefined();

        // Verification: Was the cryptographic signature calculated correctly?
        const expectedHmac = crypto.createHmac('sha256', mockSecret).update(String(bodyContent || '')).digest('hex');
        const headerMap = (headers || {}) as Record<string, string>;

        expect(headerMap['x-facio-event']).toBe('claim.created');
        expect(headerMap['x-facio-signature']).toBe(expectedHmac); // Crucial HMAC check
        expect(headerMap['Content-Type']).toBe('application/json');
    });

    test('should quietly ignore if no endpoints are active', async () => {
        await WebhookDispatcher.dispatch([], 'policy.bound', { pId: 1 });

        expect(safePostJsonMock).not.toHaveBeenCalled();
    });
});
