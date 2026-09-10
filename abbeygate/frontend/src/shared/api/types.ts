export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error?: string;
  message?: string;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/**
 * Standard API response wrapper returned by all http.request() calls.
 * Extracted from httpTransport.ts — this is now the canonical location.
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Generic record type used across API payloads. */
export type UnknownRecord = Record<string, unknown>;
