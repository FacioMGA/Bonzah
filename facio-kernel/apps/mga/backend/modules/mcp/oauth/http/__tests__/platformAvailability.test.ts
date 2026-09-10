import { afterEach, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireSupportedOAuthDeployment } from '../platformAvailability.js';
import { redactUrl } from '../../../../../http/middleware/logger.js';
afterEach(() => vi.unstubAllEnvs());
it('fails closed before tenant-host OAuth can advertise metadata or process a grant', () => {
  const next = vi.fn();
  const response = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  vi.stubEnv('KERNEL_PLATFORM_MODE', 'true');
  requireSupportedOAuthDeployment({} as Request, response as unknown as Response, next as NextFunction);
  expect(response.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled();
  expect(response.json.mock.calls[0]![0]).toMatchObject({ error: 'temporarily_unavailable' });
  vi.stubEnv('KERNEL_PLATFORM_MODE', 'false');
  requireSupportedOAuthDeployment({} as Request, response as unknown as Response, next as NextFunction);
  expect(next).toHaveBeenCalledOnce();
});
it('redacts authorization code, state and verifier in normal and percent-encoded callback URLs', () => {
  expect(redactUrl('/auth/callback?code=private-code&state=private-state&scope=openid')).toBe('/auth/callback?code=***&state=***&scope=openid');
  expect(redactUrl('/auth/callback?%63ode=private&code_verifier=private&%zz=test')).toBe('/auth/callback?%63ode=***&code_verifier=***&%zz=test');
});
