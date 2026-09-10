import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escapeHtml, HostedAuth, sessionCookie } from './hosted-auth.js';
import { KernelError } from '../domain/canonical.js';
import type { Kernel } from '../application/kernel.js';

export function hostedRoutes(app: FastifyInstance, auth: HostedAuth, kernel: Kernel) {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Facio Platform</title><link rel="stylesheet" href="/styles.css"></head><body><main class="auth-page"><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  app.get('/auth/login', async (request, reply) => {
    const query = z
      .object({ provider: z.string().optional(), continuation: z.string().max(200).optional() })
      .parse(request.query);
    const providers = auth.providers();
    if (!query.provider && providers.length !== 1) {
      return reply
        .type('text/html')
        .send(
          page(
            'Sign in with Facio',
            providers.length
              ? providers
                  .map(
                    (p) =>
                      `<p><a href="/auth/login?provider=${p.id}${query.continuation ? '&amp;continuation=' + encodeURIComponent(query.continuation) : ''}">Continue with ${escapeHtml(p.label)}</a></p>`,
                  )
                  .join('')
              : '<p>Organization sign-in is awaiting administrator configuration. No shared login token is available.</p>',
          ),
        );
    }
    const next = auth.startLogin(query.provider ?? providers[0]!.id, query.continuation);
    return reply.header('set-cookie', next.cookie).redirect(next.location);
  });
  app.get('/auth/callback', async (request, reply) => {
    const next = await auth.finishLogin(request.query, request.headers.cookie);
    return reply.header('set-cookie', next.cookies).redirect(next.location);
  });
  app.get('/api/session', async (request) => {
    const session = auth.session(request.headers.cookie);
    if (!session)
      throw new KernelError('UNAUTHENTICATED', 'Sign in with your organization account', 401);
    return { ...kernel.control.session(session.principal), csrfToken: session.csrfToken };
  });
  app.post('/auth/logout', async (request, reply) => {
    auth.verifyCsrf(auth.session(request.headers.cookie), request.headers['x-csrf-token']);
    auth.logout(request.headers.cookie);
    return reply.header('set-cookie', sessionCookie('', 0)).send({ ok: true });
  });
  app.get('/auth/connections', async (request) => {
    const session = auth.session(request.headers.cookie);
    if (!session) throw new KernelError('UNAUTHENTICATED', 'Sign in first', 401);
    return { connections: auth.store.connections(session.principal.actorId) };
  });
  app.post('/auth/connections/revoke', async (request) => {
    const session = auth.session(request.headers.cookie);
    auth.verifyCsrf(session, request.headers['x-csrf-token']);
    auth.store.revokeActor(session!.principal.actorId);
    return { ok: true };
  });
  app.get('/auth/consent', async (request, reply) => {
    const { request: key } = z
      .object({ request: z.string().min(32).max(200) })
      .parse(request.query);
    const pending = auth.authorization(key);
    if (!pending) throw new KernelError('AUTHORIZATION_EXPIRED', 'Start the connection again', 400);
    const session = auth.session(request.headers.cookie);
    if (!session) return reply.redirect('/auth/login?continuation=' + encodeURIComponent(key));
    const client = await auth.clientsStore.getClient(pending.clientId);
    // no-referrer makes Chrome's navigation form POST carry Origin:null; retain same-origin
    // provenance without disclosing the authorization request URL to external callbacks.
    reply.header('referrer-policy', 'same-origin');
    // Chrome applies form-action to the consent POST's redirect as well as its initial target.
    // Permit only this registered callback origin on this one consent document.
    reply.header(
      'content-security-policy',
      `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${new URL(pending.redirectUri).origin}`,
    );
    const body = `<p>Signed in as ${escapeHtml(session.principal.email ?? session.principal.actorId)}.</p><p><strong>${escapeHtml(client?.client_name ?? 'MCP client')}</strong> requests permission to inspect and configure your authorized sandbox tenants.</p><p>Client redirect: <code>${escapeHtml(new URL(pending.redirectUri).origin)}</code></p><p>Each operation checks current membership and requires an explicit tenant. Insurance transaction writes remain in the operator application.</p><form method="post" action="/auth/consent"><input type="hidden" name="request" value="${escapeHtml(key)}"><input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}"><button name="decision" value="allow">Allow connection</button> <button name="decision" value="deny">Deny</button></form>`;
    return reply.type('text/html').send(page('Authorize Facio Platform access', body));
  });
  app.post('/auth/consent', async (request, reply) => {
    const body = z
      .strictObject({
        request: z.string().min(32).max(200),
        csrf: z.string(),
        decision: z.enum(['allow', 'deny']),
      })
      .parse(request.body);
    const session = auth.session(request.headers.cookie);
    auth.verifyCsrf(session, body.csrf);
    return reply.redirect(
      auth.consent(body.request, session!.principal, body.decision === 'allow'),
    );
  });
}
