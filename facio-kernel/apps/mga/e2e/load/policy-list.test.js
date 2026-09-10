import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Load Test: Policy List Endpoint
 * 
 * Tests the GET /api/policies endpoint under load.
 * 
 * Target SLAs:
 * - P95 < 300ms (list endpoints should be faster)
 * - P99 < 500ms
 * - Error rate < 1%
 * - Support 50+ concurrent users
 * 
 * Run: k6 run e2e/load/policy-list.test.js -e AUTH_TOKEN=<your-token>
 */

// Custom metrics
const errorRate = new Rate('errors');
const listDuration = new Trend('list_duration');

// Load test configuration
export const options = {
    stages: [
        { duration: '30s', target: 20 },  // Ramp up to 20 users
        { duration: '1m', target: 50 },   // Ramp up to 50 users
        { duration: '2m', target: 50 },   // Stay at 50 users
        { duration: '30s', target: 0 },   // Ramp down
    ],
    thresholds: {
        'http_req_duration': ['p(95)<300', 'p(99)<500'], // Stricter for list endpoints
        'errors': ['rate<0.01'],
        'http_req_failed': ['rate<0.01'],
    },
};

// Base URL and auth token
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN;

if (!AUTH_TOKEN) {
    throw new Error('AUTH_TOKEN environment variable is required');
}

export default function () {
    const startTime = Date.now();

    const response = http.get(
        `${BASE_URL}/api/policies`,
        {
            headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Content-Type': 'application/json',
            },
            tags: { name: 'PolicyList' },
        }
    );

    const duration = Date.now() - startTime;
    listDuration.add(duration);

    // Verify response
    const success = check(response, {
        'status is 200': (r) => r.status === 200,
        'has data array': (r) => Array.isArray(r.json('data')),
        'response time < 500ms': (r) => r.timings.duration < 500,
        'response time < 300ms': (r) => r.timings.duration < 300,
    });

    errorRate.add(!success);

    // Log slow responses
    if (response.timings.duration > 500) {
        console.warn(`Slow list response: ${response.timings.duration}ms`);
    }

    // Simulate user browsing (2-4 seconds between requests)
    sleep(Math.random() * 2 + 2);
}

export function setup() {
    console.log(`Starting load test against: ${BASE_URL}`);
    console.log('Endpoint: GET /api/policies');
    console.log('Target: 50 concurrent users');
    console.log('SLA: P95 < 300ms, P99 < 500ms');
}

export function teardown(data) {
    console.log('Load test complete!');
}
