import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import helmet from 'helmet';
import { expect, it } from 'vitest';
import { applicationContentSecurityPolicy } from '../contentSecurityPolicy.js';

it('serves an enforced production policy allowing configured HTTPS images without widening scripts or connections', async () => {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: applicationContentSecurityPolicy(true) }));
  app.get('/', (_request, response) => response.send('<!doctype html><title>Workspace</title>'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    const header = response.headers.get('content-security-policy');
    expect(header).not.toBeNull();
    expect(response.headers.get('content-security-policy-report-only')).toBeNull();
    const directives = new Map(header!.split(';').map((value) => {
      const [name, ...sources] = value.trim().split(/\s+/);
      return [name, sources];
    }));
    expect(directives.get('img-src')).toContain('https:');
    expect(directives.get('img-src')).not.toContain('http:');
    for (const name of ['script-src', 'script-src-elem', 'connect-src']) {
      expect(directives.get(name)).not.toContain('https:');
      expect(directives.get(name)).not.toContain('*');
      expect(directives.get(name)).not.toContain("'unsafe-inline'");
    }
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'self'"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

it('uses the same image directives in development with reporting instead of enforcement', () => {
  expect(applicationContentSecurityPolicy(false)).toEqual({
    ...applicationContentSecurityPolicy(true), reportOnly: true,
  });
});
