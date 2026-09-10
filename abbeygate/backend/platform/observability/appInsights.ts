/**
 * Azure Application Insights Integration for Structured Logging
 * 
 * This module initializes Application Insights to automatically collect:
 * - Request/response telemetry
 * - Dependency tracking (database, external APIs)
 * - Exception tracking
 * - Custom events and metrics
 * 
 * Usage: Import this module early in server startup (before Express app initialization)
 */

import appInsights from 'applicationinsights';
import { logger } from '../utils/logger.js';

/**
 * Initialize Application Insights with enhanced telemetry
 * Call this ONCE at server startup, before creating the Express app
 */
export function initApplicationInsights(): void {
    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    const role = process.env.SERVICE_ROLE || 'abbeygate-api';

    if (!connectionString) {
        if (process.env.NODE_ENV === 'production') {
            logger.warn('⚠️  APPLICATIONINSIGHTS_CONNECTION_STRING not set in production. Telemetry disabled.');
        }
        return;
    }

    try {
        // Setup Application Insights with best practices
        appInsights
            .setup(connectionString)
            .setAutoDependencyCorrelation(true) // Correlate requests across services
            .setAutoCollectRequests(true) // HTTP requests
            .setAutoCollectPerformance(true, true) // Performance counters
            .setAutoCollectExceptions(true) // Unhandled exceptions
            .setAutoCollectDependencies(true) // Database/external API calls
            .setAutoCollectConsole(false) // Disable console collection (we use Pino)
            .setUseDiskRetryCaching(true) // Retry failed uploads
            .setSendLiveMetrics(process.env.NODE_ENV === 'production') // Live metrics stream (prod only)
            .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C) // W3C trace context
            .start();

        // Configure telemetry processor to enrich logs with correlation ID
        appInsights.defaultClient.addTelemetryProcessor((envelope) => {
            // Add custom properties to all telemetry
            envelope.tags = envelope.tags || {};
            envelope.tags['ai.cloud.role'] = role;
            envelope.tags['ai.cloud.roleInstance'] = process.env.HOSTNAME || 'unknown';

            return true; // Return true to send telemetry
        });

        logger.info({
            configured: true,
            role,
        }, 'appinsights.initialized');
    } catch (error) {
        logger.error({ event: 'appinsights.init_failed', err: error }, 'appinsights.init_failed');
    }
}

/**
 * Get the Application Insights client for custom telemetry
 * Use this for tracking custom events, metrics, or manual exception logging
 */
export function getAppInsightsClient() {
    return appInsights.defaultClient;
}

/**
 * Track custom event
 */
export function trackEvent(name: string, properties?: Record<string, string>, measurements?: Record<string, number>) {
    if (appInsights.defaultClient) {
        appInsights.defaultClient.trackEvent({ name, properties, measurements });
    }
}

/**
 * Track custom metric
 */
export function trackMetric(name: string, value: number, properties?: Record<string, string>) {
    if (appInsights.defaultClient) {
        appInsights.defaultClient.trackMetric({ name, value, properties });
    }
}

export async function flushTelemetry(timeoutMs = 2000): Promise<void> {
    const client = appInsights.defaultClient;
    if (!client) return;
    await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(250, timeoutMs));
        try {
            void client.flush();
        } finally {
            // Current SDK typings expose a no-arg flush; keep a bounded wait to avoid hanging shutdown paths.
            void timer;
        }
    });
}
