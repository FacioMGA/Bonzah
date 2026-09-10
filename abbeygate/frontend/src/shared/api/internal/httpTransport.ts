/**
 * httpTransport.ts — Transport Core
 *
 * This file contains ONLY transport-level concerns:
 *   - request<T>()      — JSON request with auth + correlation-id + error normalization
 *   - requestBinary()   — Raw binary/download request with same pipeline
 *   - Auth header injection (Bearer token from localStorage)
 *   - Correlation ID injection (x-correlation-id, x-action-id)
 *   - 401 auto-logout for protected endpoints
 *
 * Domain-specific API calls live in per-module clients under
 * `frontend/src/modules/<module>/api/`. Each client imports the transport via:
 *   import { http } from '@/src/shared/api/http';
 *   http.request<MyType>('/my-endpoint', { method: 'POST', body: ... });
 */
import { logger } from '@/src/shared/lib/logger';

import type { ApiResponse } from '@/src/shared/api/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

type ActionContext = {
  correlationId?: string;
  actionId?: string;
  timestamp?: number;
};

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  return value !== null && typeof value === 'object' && 'success' in value;
}

declare global {
  interface Window {
    __FACIO_ACTION_CONTEXT__?: ActionContext;
  }
}

// Re-export ApiResponse from its canonical location for backward compat
export type { ApiResponse } from '@/src/shared/api/types';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const cleanBase = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = `${cleanBase}/${cleanEndpoint}`;
    const token = localStorage.getItem('auth_token');
    const tenantFromStorage = String(localStorage.getItem('active_tenant_id') || '').trim();
    let tenantFromUser = '';
    try {
      const userRaw = localStorage.getItem('user_info');
      if (userRaw) {
        const parsed = JSON.parse(userRaw) as { primaryAccountId?: unknown; tenantId?: unknown };
        tenantFromUser = String(parsed?.primaryAccountId || parsed?.tenantId || '').trim();
      }
    } catch {
      tenantFromUser = '';
    }
    const tenantId = tenantFromStorage || tenantFromUser;

    const headers = new Headers(options.headers);

    // Don't set Content-Type for FormData - let browser set it with boundary
    if (!(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (tenantId) {
      headers.set('x-tenant-id', tenantId);
    }

    try {

      // [Button Contract] Inject Correlation Context if active
      const context = window.__FACIO_ACTION_CONTEXT__;
      if (context) {
        if (context.correlationId) headers.set('x-correlation-id', context.correlationId);
        if (context.actionId) headers.set('x-action-id', context.actionId);
      }

      const response = await fetch(url, {
        ...options,
        headers,
      });
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const rawBody = await response.text();
      const hasBody = rawBody.trim().length > 0;
      let data: unknown = {};
      if (hasBody && contentType.includes('application/json')) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          data = {};
        }
      }

      if (!response.ok) {
        const dataRecord = data && typeof data === 'object'
          ? data as { error?: { code?: unknown; message?: unknown; details?: unknown } }
          : {};
        if (response.status === 401) {
          // Some endpoints intentionally return 401 for non-auth reasons (e.g. public session token required).
          // Only auto-logout for protected API calls.
          const err = dataRecord.error;
          const errCode = err?.code ? String(err.code) : '';
          const isPublicEndpoint =
            cleanEndpoint.startsWith('public/') ||
            cleanEndpoint.startsWith('api/public/') ||
            url.includes('/api/public/');

          const isTenantContextError =
            errCode === 'TENANT_REQUIRED' ||
            errCode === 'TENANT_CONTEXT_ERROR' ||
            errCode === 'TENANT_MISMATCH';

          if (isPublicEndpoint || errCode === 'SESSION_TOKEN_REQUIRED' || isTenantContextError) {
            return {
              success: false,
              error: err
                ? { code: String(err.code || 'UNAUTHORIZED'), message: String(err.message || 'Unauthorized'), details: err.details }
                : { code: 'UNAUTHORIZED', message: 'Unauthorized' },
            };
          }

          // Auto-logout on 401 (protected endpoints)
          logger.warn('Session expired or invalid, logging out...');
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user_info');
          // Use window.location to force full reload and return to login
          window.location.href = '/login';
          window.location.reload();
          return { success: false, error: { code: 'UNAUTHORIZED', message: 'Session expired' } };
        }

        const err = dataRecord.error;
        return {
          success: false,
          error: err
            ? { code: String(err.code || 'HTTP_ERROR'), message: String(err.message || `HTTP ${response.status}: ${response.statusText}`), details: err.details }
            : { code: 'HTTP_ERROR', message: `HTTP ${response.status}: ${response.statusText}` },
        };
      }

      if (isApiResponse<T>(data)) return data;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network request failed',
        },
      };
    }
  }

  /**
   * Transport-level binary/download request.
   * Routes through the same auth + correlation-id pipeline as request().
   * Returns a raw Response for blob/text consumption.
   */
  async requestBinary(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const cleanBase = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = `${cleanBase}/${cleanEndpoint}`;
    const token = localStorage.getItem('auth_token');
    const tenantFromStorage = String(localStorage.getItem('active_tenant_id') || '').trim();
    let tenantFromUser = '';
    try {
      const userRaw = localStorage.getItem('user_info');
      if (userRaw) {
        const parsed = JSON.parse(userRaw) as { primaryAccountId?: unknown; tenantId?: unknown };
        tenantFromUser = String(parsed?.primaryAccountId || parsed?.tenantId || '').trim();
      }
    } catch {
      tenantFromUser = '';
    }
    const tenantId = tenantFromStorage || tenantFromUser;

    const headers = new Headers(options.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (tenantId) {
      headers.set('x-tenant-id', tenantId);
    }

    const context = window.__FACIO_ACTION_CONTEXT__;
    if (context) {
      if (context.correlationId) headers.set('x-correlation-id', context.correlationId);
      if (context.actionId) headers.set('x-action-id', context.actionId);
    }

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const cloned = response.clone();
        const payload = await cloned.json();
        const code = String(payload?.error?.code || '').trim();
        const message = String(payload?.error?.message || '').trim();
        if (code || message) {
          errorMessage = code ? `${code}: ${message || response.statusText}` : message;
        }
      } catch {
        try {
          const text = await response.clone().text();
          if (text.trim()) errorMessage = `${errorMessage} - ${text.trim()}`;
        } catch {
          // no-op, keep default message
        }
      }
      if (response.status === 401) {
        let errCode = '';
        try {
          const cloned = response.clone();
          const payload = await cloned.json();
          errCode = String(payload?.error?.code || '');
        } catch {
          errCode = '';
        }
        const isTenantContextError =
          errCode === 'TENANT_REQUIRED' ||
          errCode === 'TENANT_CONTEXT_ERROR' ||
          errCode === 'TENANT_MISMATCH';
        if (!isTenantContextError) {
          logger.warn('Session expired or invalid during binary request, logging out...');
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user_info');
          window.location.href = '/login';
          window.location.reload();
        }
      }
      throw new Error(errorMessage);
    }

    return response;
  }
}

export const api = new ApiClient();
export default ApiClient;
