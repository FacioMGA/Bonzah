import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Load Test: Quote API
 * 
 * Tests the auto insurance quote endpoint under load.
 * 
 * Target SLAs:
 * - P95 < 500ms
 * - P99 < 1000ms
 * - Error rate < 1%
 * - Support 50+ concurrent users
 * 
 * Run: k6 run e2e/load/quote-api.test.js
 */

// Custom metrics
const errorRate = new Rate('errors');
const quoteDuration = new Trend('quote_duration');

// Load test configuration
export const options = {
    stages: [
        { duration: '30s', target: 10 },  // Ramp up to 10 users
        { duration: '1m', target: 30 },   // Ramp up to 30 users
        { duration: '2m', target: 50 },   // Ramp up to 50 users
        { duration: '1m', target: 50 },   // Stay at 50 users
        { duration: '30s', target: 0 },   // Ramp down to 0
    ],
    thresholds: {
        'http_req_duration': ['p(95)<500', 'p(99)<1000'], // 95% < 500ms, 99% < 1s
        'errors': ['rate<0.01'], // Error rate < 1%
        'http_req_failed': ['rate<0.01'], // Failed requests < 1%
    },
};

// Test data: Sample quote request
const quotePayload = {
    vehicleRegistration: 'ABC123',
    vehicleYear: 2020,
    vehicleMake: 'Toyota',
    vehicleModel: 'Corolla',
    vehicleValue: 15000,
    coverageType: 'COMPREHENSIVE',
    driverAge: 35,
    driverExperience: 10,
    ncdYears: 3,
    postcode: '1000',
};

// Base URL (override with -e BASE_URL=https://staging.example.com)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
    // Public flow requires a session first, then rate.
    const session = http.post(
        `${BASE_URL}/api/public/auto/session`,
        JSON.stringify({ origin: 'customer' }),
        {
            headers: { 'Content-Type': 'application/json' },
            tags: { name: 'QuoteSessionCreate' },
        }
    );
    const sessionToken = session.json('data.publicSessionToken');
    if (!sessionToken) {
        errorRate.add(true);
        check(session, {
            'session create status 200': (r) => r.status === 200,
            'session has token': (r) => r.json('data.publicSessionToken') !== undefined,
        });
        sleep(1);
        return;
    }

    // Simulate user requesting a quote
    const startTime = Date.now();
    const response = http.post(
        `${BASE_URL}/api/public/auto/session/${sessionToken}/rate`,
        JSON.stringify(quotePayload),
        {
            headers: {
                'Content-Type': 'application/json',
            },
            tags: { name: 'QuoteAPI' },
        }
    );

    const duration = Date.now() - startTime;
    quoteDuration.add(duration);

    // Verify response
    const success = check(response, {
        'status is 200': (r) => r.status === 200,
        'has premium': (r) => r.json('data.primaryOption.annualPremium') !== undefined,
        'premium is number': (r) => typeof r.json('data.primaryOption.annualPremium') === 'number',
        'response time < 1s': (r) => r.timings.duration < 1000,
        'response time < 500ms': (r) => r.timings.duration < 500,
    });

    errorRate.add(!success);

    // Log slow responses
    if (response.timings.duration > 1000) {
        console.warn(`Slow response: ${response.timings.duration}ms`);
    }

    // Simulate user think time (1-3 seconds between requests)
    sleep(Math.random() * 2 + 1);
}

// Setup function (runs once before test)
export function setup() {
    console.log(`Starting load test against: ${BASE_URL}`);
    console.log('Target: 50 concurrent users');
    console.log('Duration: 5 minutes');
    console.log('SLA: P95 < 500ms, P99 < 1000ms, Error rate < 1%');
}

// Teardown function (runs once after test)
export function teardown(data) {
    console.log('Load test complete!');
    console.log('Check results for P95/P99 metrics and error rates.');
}
