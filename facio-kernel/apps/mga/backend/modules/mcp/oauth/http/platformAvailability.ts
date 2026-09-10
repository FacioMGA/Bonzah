import type { RequestHandler } from 'express';

/** Legacy tenant-host OAuth has no shared-platform membership broker. Do not issue or advertise grants. */
export const requireSupportedOAuthDeployment: RequestHandler = (_req, res, next) => {
  if (process.env.KERNEL_PLATFORM_MODE !== 'true') return next();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'Workspace OAuth is not enabled in this deployment. Use an explicitly issued workspace MCP API key.' });
};
