import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Smoke Test: Basic API Health
 * 
 * Quick smoke test to verify basic API functionality.
 * Runs with 1-5 users for 1 minute.
 * 
 * Use this before full load tests to catch obvious issues.
 * 
 * Run: k6 run e2e/load/smoke.test.js
 */

const errorRate = new Rate('errors');

export const options = {
    vus: 5, // 5 virtual users
    duration: '1m',
    thresholds: {
        'http_req_duration': ['p(95)<1000'], // Relaxed for smoke test
        'errors': ['rate<0.05'], // 5% error rate acceptable for smoke
        'http_req_failed': ['rate<0.05'],
    },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
    // Test health endpoint
    const healthResponse = http.get(`${BASE_URL}/health`);
    check(healthResponse, {
        'health status 200': (r) => r.status === 200,
        'health has status': (r) => r.json('status') === 'ok',
    });

    sleep(1);

    // Test database health
    const dbResponse = http.get(`${BASE_URL}/health/db`);
    check(dbResponse, {
        'db status 200': (r) => r.status === 200,
    });

    sleep(1);

    // Test public rating flow (session create + rate)
    const sessionResponse = http.post(
        `${BASE_URL}/api/public/auto/session`,
        JSON.stringify({ origin: 'customer' }),
        { headers: { 'Content-Type': 'application/json' } }
    );
    const sessionToken = sessionResponse.json('data.publicSessionToken');
    const quotePayload = {
        quoteData: {
            firstName: 'Smoke',
            lastName: 'Test',
            dateOfBirth: '1990-01-01',
            email: 'smoke@example.com',
            vehicleValue: 15000,
            make: 'Toyota',
            model: 'Corolla',
            year: 2020,
            engineSize: 1600,
            coverRequired: 'Comprehensive',
            requiredExcess: '€250',
            licenseYears: 10,
            vehicleUse: 'Private',
            hasClaims: false,
            hasConvictions: false,
        },
    };
    const quoteResponse = sessionToken
        ? http.post(
            `${BASE_URL}/api/public/auto/session/${sessionToken}/rate`,
            JSON.stringify(quotePayload),
            { headers: { 'Content-Type': 'application/json' } }
        )
        : sessionResponse;

    const success = check(quoteResponse, {
        'quote status 200': (r) => r.status === 200,
        'quote has premium': (r) => r.json('data.primaryOption.annualPremium') !== undefined,
    });

    errorRate.add(!success);

    sleep(2);
}

export function setup() {
    console.log('🔥 Running smoke test...');
    console.log(`Target: ${BASE_URL}`);
}

export function teardown(data) {
    console.log('✅ Smoke test complete!');
}
