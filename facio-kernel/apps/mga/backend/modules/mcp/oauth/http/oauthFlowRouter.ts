import { requireSupportedOAuthDeployment } from './platformAvailability.js';
/* eslint-disable max-lines -- OAuth 2.1 + DCR flow router: the RFC 7591/PKCE/consent/token endpoints are one cohesive AS surface kept together for spec traceability (ADR-0040). */
/**
 * OAuth 2.1 + DCR flow endpoints (ADR-0040 §2 — Phase B).
 *
 * Mounted at the ROOT of the tenant host so the URLs published by the
 * AS metadata document resolve. The flow:
 *
 *   1. POST /oauth/register     (RFC 7591 DCR — open registration)
 *   2. GET  /oauth/authorize    (PKCE + scope + resource validation,
 *                                stashes the request, redirects to
 *                                consent screen)
 *   3. GET  /oauth/consent      (renders consent UI — minimal in
 *                                Phase B; React in Phase C)
 *   4. POST /oauth/consent/decision  (Allow/Deny → issues code,
 *                                     redirects to redirect_uri)
 *   5. POST /oauth/token        (code exchange OR refresh_token rotation)
 *   6. POST /oauth/revoke       (RFC 7009 — access OR refresh tokens)
 *
 * Per-tenant: every call is tenant-scoped via the
 * resolveOperatingTenant middleware applied at app.ts. Cross-tenant
 * token use is rejected by the mcpAuthMiddleware on the MCP mount.
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { AuditLogger } from '../../../../platform/audit/logger.js';
import { getClientIpForRateLimit } from '../../../../platform/http/middleware/rateLimit.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../../platform/utils/logger.js';
import {
    assertCanGrantScopes,
    ALL_PERMISSIONS,
} from '../../../accessControl/domain/permissionTaxonomy.js';
import {
    resolveEffectivePermissionsForUser,
    type ResolvedPermission,
} from '../../../accessControl/app/permissionService.js';
import { authenticate } from '../../../../platform/http/middleware/auth.js';
import { resolveOperatingTenant } from '../../../../platform/http/middleware/resolveTenant.js';
import { ALL_MCP_SCOPES, parseScopeString } from '../domain/scopes.js';
import { resolveResourceParameter } from '../domain/resource.js';
import {
    consumeAuthorizationCode,
    issueAuthorizationCode,
} from '../infra/oauthAuthorizationCodeStore.js';
import {
    deleteAuthorizeRequest,
    loadAuthorizeRequest,
    stashAuthorizeRequest,
} from '../infra/oauthAuthorizeRequestStore.js';
import {
    issueAccessToken,
    revokeAccessToken,
} from '../infra/oauthAccessTokenStore.js';
import {
    createOAuthClient,
    createRefreshToken,
    findActiveRefreshToken,
    findOAuthClientByClientId,
    markRefreshTokenRotated,
    revokeRefreshToken,
    verifyClientCredentials,
} from '../infra/oauthClientRepository.js';

const router = Router();

// Tenant ALS context required by every OAuth endpoint (issuer +
// resource URLs read getTenantConfig().publicBaseUrl). Scoping is
// enforced at the MOUNT level: this router is mounted at `/oauth`
// in backend/index.ts so the middleware only runs for `/oauth/*`
// requests, never for `/health` or any other root-level handler
// (root cause of the 2026-05-28 18:24 UTC + 18:49 UTC deploy
// timeouts — Kubernetes /health probe got 403 TENANT_UNRESOLVED).
router.use(requireSupportedOAuthDeployment);
router.use(resolveOperatingTenant);

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function oauthError(res: Response, status: number, error: string, description: string): void {
    res.status(status).json({ error, error_description: description });
}

/**
 * Browser-side consent shell.
 *
 * The /oauth/consent page loads inside a browser tab opened by the
 * OAuth client (ChatGPT, Claude). The BO uses JWT-in-localStorage
 * (no server-readable cookie), so a plain server-rendered consent
 * page can NEVER read the BO user's session. This shell:
 *
 *   1. Loads with NO server auth required (returns HTML).
 *   2. JS reads JWT from localStorage; if missing → redirect to
 *      /login?next=/oauth/consent?req=... (BO React app honours
 *      `?next=` post-login).
 *   3. JS calls the authed JSON endpoint to fetch consent metadata
 *      (client name + scopes + role-gate decision).
 *   4. User clicks Allow → JS POSTs to the authed decision endpoint
 *      with the JWT, gets back { redirect_url }, navigates the
 *      browser there to hand the code back to ChatGPT.
 *
 * The consent decision logic lives in JSON endpoints, so all the
 * BO JWT auth + RLS + audit machinery applies unchanged.
 */

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    // RFC 7636 §4.2 — base64url-encoded SHA256 of the verifier, no padding.
    const computed = hash.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (computed.length !== codeChallenge.length) return false;
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
}

function isValidRedirectUri(uri: string, allowLocalhost: boolean): boolean {
    try {
        const u = new URL(uri);
        if (u.protocol !== 'https:' && !(allowLocalhost && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
            return false;
        }
        if (uri.includes('*')) return false;
        if (u.search) return false;
        if (u.hash) return false;
        return true;
    } catch {
        return false;
    }
}

// ----------------------------------------------------------------------
// POST /oauth/register — RFC 7591 Dynamic Client Registration
// ----------------------------------------------------------------------

const RegisterBodySchema = z
    .object({
        client_name: z.string().trim().min(1).max(200),
        client_uri: z.string().trim().url().optional(),
        redirect_uris: z.array(z.string().trim().url()).min(1).max(10),
        scope: z.string().trim().optional(),
        token_endpoint_auth_method: z.enum(['none', 'client_secret_post']).default('none'),
        // RFC 7591 grant_types — we only support authorization_code (+ refresh implicitly).
        grant_types: z.array(z.string()).optional(),
        response_types: z.array(z.string()).optional(),
    })
    // RFC 7591 §2: unknown client metadata MUST be ignored, not rejected.
    // `.strict()` here broke Claude's DCR (sends logo_uri etc.); ChatGPT
    // only passed because it happens to send no extra fields.
    .strip();

const dcrLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3,
    keyGenerator: (req) => `${getTenantConfig().id}:${getClientIpForRateLimit(req)}`,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        oauthError(res, 429, 'too_many_requests', 'DCR rate limit exceeded (3 per minute per IP per tenant).');
    },
});

// Paths are RELATIVE to the `/oauth` mount in backend/index.ts.
// Full URLs: /oauth/register, /oauth/authorize, /oauth/consent,
// /oauth/consent/decision, /oauth/token, /oauth/revoke.
router.post('/register', dcrLimiter, async (req: Request, res: Response) => {
    const parsed = RegisterBodySchema.safeParse(req.body);
    if (!parsed.success) {
        oauthError(res, 400, 'invalid_client_metadata', parsed.error.message);
        return;
    }
    const body = parsed.data;
    const tenant = getTenantConfig();
    const allowLocalhost = tenant.tenantSlug.includes('dev') || tenant.tenantSlug.includes('local');
    for (const uri of body.redirect_uris) {
        if (!isValidRedirectUri(uri, allowLocalhost)) {
            oauthError(res, 400, 'invalid_redirect_uri', `redirect_uri "${uri}" must be HTTPS, contain no wildcards / query / fragment.`);
            return;
        }
    }
    const requestedScopes = parseScopeString(body.scope || ALL_MCP_SCOPES.join(' '));
    if (requestedScopes.length === 0) {
        oauthError(res, 400, 'invalid_scope', 'At least one valid scope is required.');
        return;
    }
    if (body.grant_types && !body.grant_types.every((g) => ['authorization_code', 'refresh_token'].includes(g))) {
        oauthError(res, 400, 'invalid_client_metadata', 'Only grant_types authorization_code + refresh_token are supported.');
        return;
    }
    if (body.response_types && !body.response_types.every((r) => r === 'code')) {
        oauthError(res, 400, 'invalid_client_metadata', 'Only response_types=code is supported.');
        return;
    }
    const isPublic = body.token_endpoint_auth_method === 'none';
    try {
        const { client, rawSecret } = await createOAuthClient({
            operatingTenantId: tenant.id,
            clientName: body.client_name,
            clientUri: body.client_uri ?? null,
            redirectUris: body.redirect_uris,
            scopes: requestedScopes,
            registrationKind: 'dcr',
            public: isPublic,
        });
        void AuditLogger.log(
            client.id,
            'OAUTH_CLIENT',
            'OAUTH.CLIENT_REGISTERED',
            `oauth_client:${client.clientId}`,
            'SYSTEM',
            {
                clientId: client.clientId,
                clientName: client.clientName,
                redirectUris: client.redirectUris,
                scopes: client.scopes,
                registrationKind: 'dcr',
                isPublic,
            },
        );
        res.status(201).json({
            client_id: client.clientId,
            ...(rawSecret ? { client_secret: rawSecret } : {}),
            client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
            client_name: client.clientName,
            ...(client.clientUri ? { client_uri: client.clientUri } : {}),
            redirect_uris: client.redirectUris,
            scope: client.scopes.join(' '),
            token_endpoint_auth_method: isPublic ? 'none' : 'client_secret_post',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
        });
    } catch (err) {
        logger.error({ err }, 'mcp.oauth.dcr.failed');
        oauthError(res, 500, 'server_error', 'Failed to register OAuth client.');
    }
});

// ----------------------------------------------------------------------
// GET /oauth/authorize — PKCE-validated, stash + redirect to consent
// ----------------------------------------------------------------------

const AuthorizeQuerySchema = z
    .object({
        response_type: z.literal('code'),
        client_id: z.string().trim().min(1),
        redirect_uri: z.string().trim().url(),
        scope: z.string().trim().optional(),
        state: z.string().trim().min(1).max(512),
        code_challenge: z.string().trim().min(43).max(128),
        code_challenge_method: z.literal('S256'),
        resource: z.string().trim().url(),
    })
    // RFC 6749 §3.1: the authorization server MUST ignore unrecognized
    // request parameters. Real clients send extra OIDC params (ChatGPT
    // sends `ui_locales`; others send `prompt` / `login_hint` / `nonce`),
    // so strip unknown keys instead of rejecting the whole authorize
    // request with `unrecognized_keys`.
    .strip();

router.get('/authorize', async (req: Request, res: Response) => {
    const parsed = AuthorizeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        oauthError(res, 400, 'invalid_request', parsed.error.message);
        return;
    }
    const q = parsed.data;
    const client = await findOAuthClientByClientId(q.client_id);
    if (!client) {
        oauthError(res, 400, 'unauthorized_client', 'Unknown or revoked client_id.');
        return;
    }
    if (!client.redirectUris.includes(q.redirect_uri)) {
        oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uri does not match a registered URI.');
        return;
    }
    const tenant = getTenantConfig();
    if (client.operatingTenantId !== tenant.id) {
        oauthError(res, 403, 'unauthorized_client', 'Client is registered against a different tenant.');
        return;
    }
    const resource = resolveResourceParameter(q.resource);
    if (!resource) {
        logger.warn(
            {
                clientId: q.client_id,
                receivedResource: q.resource,
                expectedOneOf: [
                    'https://' + getTenantConfig().publicBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/api/v1/mcp/operator',
                    'https://' + getTenantConfig().publicBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/api/v1/mcp/config',
                ],
            },
            'mcp.oauth.authorize.invalid_target',
        );
        oauthError(res, 400, 'invalid_target', `resource must be a canonical MCP mount URL for this tenant; received "${q.resource}".`);
        return;
    }
    const requestedScopes = parseScopeString(q.scope || client.scopes.join(' '));
    // Narrow to client's registered scope set.
    const intersected = requestedScopes.filter((s) => client.scopes.includes(s));
    if (intersected.length === 0) {
        oauthError(res, 400, 'invalid_scope', 'No requested scope is registered for this client.');
        return;
    }
    const { requestId } = await stashAuthorizeRequest({
        clientId: client.clientId,
        operatingTenantId: tenant.id,
        redirectUri: q.redirect_uri,
        requestedScopes: intersected,
        resource: resource.url,
        codeChallenge: q.code_challenge,
        codeChallengeMethod: 'S256',
        state: q.state,
        issuedAt: new Date().toISOString(),
    });
    // Redirect to consent screen. Phase B serves a minimal HTML page
    // (renderConsentScreen below); Phase C replaces with React.
    res.redirect(302, `/oauth/consent?req=${encodeURIComponent(requestId)}`);
});

// ----------------------------------------------------------------------
// GET /oauth/consent — minimal HTML for Phase B (Phase C swaps for React)
// ----------------------------------------------------------------------

const CONSENT_SHELL_JS = `(function() {
  var params = new URLSearchParams(window.location.search);
  var REQ = (params.get('req') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  var root = document.getElementById('root');

  // ----- Helpers --------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }
  function readJwt() {
    return window.localStorage.getItem('auth_token');
  }
  function redirectToLogin() {
    window.location.href = '/login?next=' + encodeURIComponent('/oauth/consent?req=' + REQ);
  }
  function initials(name) {
    return String(name || '?')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function(w) { return w[0].toUpperCase(); })
      .join('') || '?';
  }
  function familyLabel(family) {
    if (family === 'operator') return ['Operator MCP', 'Customer operations & analytics'];
    if (family === 'config')   return ['Configuration MCP', 'Product configuration & sandbox publish'];
    return [family, ''];
  }
  function badgeLabel(level) {
    if (level === 'mutate') return 'Modify';
    if (level === 'admin')  return 'Sandbox';
    if (level === 'comm')   return 'Email';
    return 'Read-only';
  }

  // ----- Inline SVG icons (CSP-friendly, no remote requests) ------------
  var ICONS = {
    search: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    mail:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    chart:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    pencil: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M16 4l4 4-12 12H4v-4z"/></svg>',
    book:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M4 17a3 3 0 0 1 3-3h12"/></svg>',
    check:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 12.5l4.5 4.5L20 7"/></svg>',
    flask:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19L14 9V3"/><path d="M7 14h10"/></svg>',
    rocket: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4.5 16.5c-1 1.5-1 5 0 5s3.5 0 5-1M14 7l3 3M18.5 2.5c1 3 0 9-7 14l-4-4c5-7 11-8 14-7zM7 21l-4-4 1-3 6 6z"/></svg>',
    lock:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="4" y="11" width="16" height="11" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>',
    alert:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8v5M12 17v.01M3.5 19h17a2 2 0 0 0 1.7-3l-8.5-14a2 2 0 0 0-3.4 0l-8.5 14a2 2 0 0 0 1.7 3z"/></svg>',
    shield: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 3l8 3v7c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V6z"/></svg>'
  };
  function iconFor(key) { return ICONS[key] || ICONS.shield; }

  // ----- Render passes --------------------------------------------------
  function renderLoading() {
    root.innerHTML = '<div class="loading"><div class="loading-spinner"></div>' +
      '<div class="loading-text">Preparing authorization request\u2026</div></div>';
  }

  function renderError(msg) {
    root.innerHTML = '<div class="error-state">' +
      '<div class="error-icon">' + iconFor('alert') + '</div>' +
      '<div class="error-text">' + esc(msg) + '</div>' +
      '</div>';
  }

  function renderConsent(data) {
    var clientName = data.clientName || 'this app';
    var grantable  = data.grantable || [];

    // Group scopes by family preserving the order they appeared.
    var groups = [];
    var seenFamily = {};
    grantable.forEach(function(s) {
      if (!seenFamily[s.family]) {
        seenFamily[s.family] = { family: s.family, scopes: [] };
        groups.push(seenFamily[s.family]);
      }
      seenFamily[s.family].scopes.push(s);
    });

    var groupsHtml = groups.map(function(g) {
      var labels = familyLabel(g.family);
      var rowsHtml = g.scopes.map(function(s) {
        return '<div class="scope-row" data-level="' + esc(s.mutationLevel) + '">' +
          '<div class="scope-icon">' + iconFor(s.icon) + '</div>' +
          '<div class="scope-text">' +
            '<div class="scope-title">' + esc(s.displayName) + '</div>' +
            '<div class="scope-desc">' + esc(s.description) + '</div>' +
          '</div>' +
          '<div class="scope-badge ' + esc(s.mutationLevel) + '">' + esc(badgeLabel(s.mutationLevel)) + '</div>' +
        '</div>';
      }).join('');
      return '<section class="permission-group">' +
        '<div class="group-header">' +
          '<div class="group-title"><span class="dot-mark"></span>' + esc(labels[0]) + '</div>' +
          '<div class="group-sub">' + esc(labels[1]) + '</div>' +
        '</div>' +
        rowsHtml +
      '</section>';
    }).join('');

    var rejectedHtml = '';
    if ((data.rejected || []).length > 0) {
      rejectedHtml = '<div class="rejected-block">' +
        '<strong>Some scopes were filtered by your role:</strong>' +
        '<ul>' + data.rejected.map(function(r) {
          var reason = r.reason === 'requires_admin' ? 'requires an ADMIN' :
                       r.reason === 'requires_explicit_operator_mutate' ? 'requires operator.mutate' :
                       r.reason;
          return '<li><code>' + esc(r.scope) + '</code> \u2014 ' + esc(reason) + '</li>';
        }).join('') + '</ul></div>';
    }

    var tenantBadge = data.tenantSlug
      ? '<span class="tenant-badge"><span class="tb-dot"></span>' + esc(data.tenantSlug) + (data.tenantCountry ? ' \u00b7 ' + esc(data.tenantCountry) : '') + '</span>'
      : '';

    var signedAs = data.userName ? esc(data.userName) + ' (' + esc(data.userRole) + ')' : esc(data.userRole);

    root.innerHTML =
      '<header class="brand-bar">' +
        '<div class="brand-mark"><span class="dot"></span>Abbeygate</div>' +
        tenantBadge +
      '</header>' +

      '<section class="hero">' +
        '<div class="client-avatar">' + esc(initials(clientName)) + '</div>' +
        '<h1 class="hero-title">Authorize <strong>' + esc(clientName) + '</strong></h1>' +
        '<p class="hero-lead">This app is requesting access to your Abbeygate account. Review the permissions below and approve to continue.</p>' +
      '</section>' +

      '<div class="permissions">' + groupsHtml + '</div>' +

      rejectedHtml +

      '<div class="actions">' +
        '<button id="allow" class="primary"' + (grantable.length === 0 ? ' disabled' : '') + '>Allow access</button>' +
        '<button id="deny" class="ghost">Cancel</button>' +
      '</div>' +

      '<footer class="meta">' +
        '<div class="auth-context">' +
          iconFor('lock') +
          '<span>Signed in as <strong>' + signedAs + '</strong></span>' +
        '</div>' +
        '<ul class="trust-list">' +
          '<li>Access tokens expire in 1 hour and refresh tokens rotate every 30 days</li>' +
          '<li>Every action this app takes is audited per Lloyd\\'s coverholder standards</li>' +
          '<li>Revoke this connection anytime in BO \u2192 Configure \u2192 AI / MCP \u2192 OAuth clients</li>' +
        '</ul>' +
        '<div class="redirect-note">After approval you will be redirected to <code>' + esc(data.redirectUri) + '</code></div>' +
      '</footer>';

    var allowBtn = document.getElementById('allow');
    var denyBtn = document.getElementById('deny');
    if (allowBtn) allowBtn.addEventListener('click', function() { submitDecision('allow'); });
    if (denyBtn) denyBtn.addEventListener('click', function() { submitDecision('deny'); });
  }

  function setButtonsLoading(label) {
    var allowBtn = document.getElementById('allow');
    var denyBtn = document.getElementById('deny');
    if (allowBtn) { allowBtn.disabled = true; if (label) allowBtn.textContent = label; }
    if (denyBtn) denyBtn.disabled = true;
  }

  function submitDecision(decision) {
    var jwt = readJwt();
    if (!jwt) { redirectToLogin(); return; }
    if (decision === 'allow') setButtonsLoading('Granting access\u2026');
    else setButtonsLoading('Cancelling\u2026');

    fetch('/oauth/consent/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
      body: JSON.stringify({ req: REQ, decision: decision })
    }).then(function(r) {
      return r.json().then(function(j) { return { ok: r.ok, status: r.status, body: j }; });
    }).then(function(r) {
      if (r.ok && r.body.redirect_url) {
        window.location.href = r.body.redirect_url;
      } else if (r.status === 401) {
        redirectToLogin();
      } else {
        renderError('Failed to record consent: ' + (r.body && r.body.error_description ? r.body.error_description : 'Unknown error'));
      }
    }).catch(function(err) {
      renderError('Network error: ' + err.message);
    });
  }

  function loadConsentData() {
    if (!REQ) { renderError('Missing or invalid req parameter'); return; }
    var jwt = readJwt();
    if (!jwt) { redirectToLogin(); return; }

    fetch('/oauth/consent/data?req=' + encodeURIComponent(REQ), {
      headers: { 'Authorization': 'Bearer ' + jwt }
    }).then(function(r) {
      if (r.status === 401) { redirectToLogin(); return null; }
      return r.json().then(function(j) { return { ok: r.ok, status: r.status, body: j }; });
    }).then(function(r) {
      if (!r) return;
      if (r.ok) {
        renderConsent(r.body);
      } else {
        renderError(r.body && r.body.error_description ? r.body.error_description : ('HTTP ' + r.status));
      }
    }).catch(function(err) {
      renderError('Network error: ' + err.message);
    });
  }

  renderLoading();
  loadConsentData();
})();
`;

function renderConsentShellHtml(): string {
    // CSP-compliant:
    //  - <script src="/oauth/consent.js"> matches `script-src-elem 'self'`
    //  - inline <style> matches `style-src 'self' 'unsafe-inline'`
    //  - <link rel=stylesheet> to fonts.googleapis.com matches `style-src ...googleapis.com`
    //  - Inter from fonts.gstatic.com matches `font-src 'self' data: ...gstatic.com`
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Authorize \u2014 Abbeygate</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
  <style>
    :root {
      --brand: #004A8A;
      --brand-dark: #003A70;
      --brand-deep: #002A4D;
      --brand-light: #4A9FD8;
      --brand-50: #EAF2FF;
      --canvas: #FCFBF7;
      --surface: #FFFFFF;
      --ink: #0F172A;
      --ink-2: #334155;
      --ink-3: #64748B;
      --ink-4: #94A3B8;
      --line: rgba(15, 23, 42, 0.08);
      --line-strong: rgba(15, 23, 42, 0.14);
      --shadow-sm: 0 1px 2px 0 rgba(15, 23, 42, 0.04);
      --shadow-md: 0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 4px -1px rgba(15, 23, 42, 0.04);
      --shadow-xl: 0 24px 64px -16px rgba(15, 23, 42, 0.18), 0 8px 24px -8px rgba(0, 74, 138, 0.08);
      --amber: #B45309;
      --amber-bg: #FEF3C7;
      --red: #B91C1C;
      --red-bg: #FEF2F2;
      --green: #15803D;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-feature-settings: 'cv11', 'ss01', 'ss03';
      background:
        radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0, 74, 138, 0.06), transparent 60%),
        radial-gradient(ellipse 50% 40% at 100% 100%, rgba(74, 159, 216, 0.08), transparent 60%),
        var(--canvas);
      min-height: 100vh;
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 48px 20px 96px;
    }

    main.card {
      width: 100%;
      max-width: 560px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: var(--shadow-xl);
      overflow: hidden;
    }

    .brand-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 28px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(252, 251, 247, 0.6), transparent);
    }
    .brand-mark {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      letter-spacing: -0.01em;
      font-size: 14px;
      color: var(--ink-2);
    }
    .brand-mark .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--brand);
      box-shadow: 0 0 0 3px rgba(0, 74, 138, 0.12);
    }
    .tenant-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--ink-3);
      background: rgba(15, 23, 42, 0.04);
      border: 1px solid var(--line);
    }
    .tenant-badge .tb-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--green);
    }

    .hero {
      padding: 40px 36px 28px;
      text-align: center;
    }
    .client-avatar {
      width: 64px; height: 64px;
      margin: 0 auto 20px;
      border-radius: 18px;
      background: linear-gradient(135deg, var(--brand), var(--brand-light));
      color: white;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 22px;
      letter-spacing: -0.02em;
      box-shadow: 0 12px 24px -8px rgba(0, 74, 138, 0.35), inset 0 1px 0 rgba(255,255,255,0.15);
    }
    h1.hero-title {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.2;
      color: var(--ink);
    }
    h1.hero-title strong { font-weight: 700; }
    .hero-lead {
      margin: 0;
      font-size: 14px;
      line-height: 1.55;
      color: var(--ink-3);
      max-width: 380px;
      margin-inline: auto;
    }

    .permissions { padding: 8px 28px 8px; }

    .permission-group {
      margin: 16px 0;
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
      background: var(--surface);
    }
    .group-header {
      padding: 14px 18px 12px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(0, 74, 138, 0.02), transparent);
    }
    .group-title {
      display: flex; align-items: center; gap: 10px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--brand);
    }
    .group-sub {
      margin: 4px 0 0 22px;
      font-size: 12.5px;
      color: var(--ink-3);
    }

    .scope-row {
      display: grid;
      grid-template-columns: 36px 1fr auto;
      gap: 14px;
      align-items: flex-start;
      padding: 14px 18px;
      border-top: 1px solid var(--line);
      transition: background-color 0.15s ease;
    }
    .scope-row:first-of-type { border-top: none; }
    .scope-row:hover { background-color: rgba(0, 74, 138, 0.02); }

    .scope-icon {
      width: 36px; height: 36px;
      border-radius: 10px;
      background: var(--brand-50);
      color: var(--brand-dark);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .scope-icon svg { width: 18px; height: 18px; stroke-width: 1.75; }
    .scope-row[data-level="mutate"] .scope-icon {
      background: var(--amber-bg);
      color: var(--amber);
    }
    .scope-row[data-level="admin"] .scope-icon {
      background: #FEE2E2;
      color: var(--red);
    }

    .scope-text { min-width: 0; }
    .scope-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
      margin-bottom: 3px;
      line-height: 1.3;
      letter-spacing: -0.005em;
    }
    .scope-desc {
      font-size: 12.5px;
      color: var(--ink-3);
      line-height: 1.5;
    }

    .scope-badge {
      align-self: center;
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .scope-badge.read  { color: var(--ink-3); background: rgba(15, 23, 42, 0.05); }
    .scope-badge.comm  { color: var(--brand-dark); background: var(--brand-50); }
    .scope-badge.mutate{ color: var(--amber); background: var(--amber-bg); }
    .scope-badge.admin { color: var(--red); background: #FEE2E2; }

    .rejected-block {
      margin: 16px 28px 8px;
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--red-bg);
      border: 1px solid rgba(185, 28, 28, 0.18);
      color: var(--red);
      font-size: 12.5px;
      line-height: 1.55;
    }
    .rejected-block strong { font-weight: 600; }
    .rejected-block ul { margin: 6px 0 0; padding-left: 20px; }
    .rejected-block code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      background: rgba(255,255,255,0.5);
      padding: 1px 6px;
      border-radius: 4px;
    }

    .actions {
      padding: 24px 28px 8px;
      display: flex;
      gap: 10px;
      flex-direction: row-reverse;
    }
    button {
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.005em;
      padding: 11px 22px;
      border-radius: 10px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.15s ease;
      line-height: 1.2;
    }
    button.primary {
      flex: 1;
      background: var(--brand);
      color: white;
      box-shadow: 0 6px 14px -4px rgba(0, 74, 138, 0.4), inset 0 1px 0 rgba(255,255,255,0.12);
    }
    button.primary:hover:not(:disabled) {
      background: var(--brand-dark);
      transform: translateY(-1px);
      box-shadow: 0 10px 22px -6px rgba(0, 74, 138, 0.45), inset 0 1px 0 rgba(255,255,255,0.12);
    }
    button.primary:active:not(:disabled) { transform: translateY(0); }
    button.ghost {
      background: transparent;
      color: var(--ink-2);
      border-color: var(--line-strong);
    }
    button.ghost:hover:not(:disabled) {
      background: rgba(15, 23, 42, 0.04);
      color: var(--ink);
    }
    button:disabled { opacity: 0.55; cursor: not-allowed; transform: none !important; }

    footer.meta {
      margin-top: 24px;
      padding: 22px 28px 26px;
      border-top: 1px solid var(--line);
      background: linear-gradient(180deg, transparent, rgba(252, 251, 247, 0.6));
    }
    .auth-context {
      font-size: 12.5px;
      color: var(--ink-2);
      margin-bottom: 14px;
      display: flex; align-items: center; gap: 8px;
    }
    .auth-context strong { color: var(--ink); font-weight: 600; }
    .auth-context svg { width: 14px; height: 14px; color: var(--ink-4); flex-shrink: 0; }

    .trust-list {
      list-style: none;
      padding: 0;
      margin: 0 0 14px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .trust-list li {
      font-size: 11.5px;
      color: var(--ink-3);
      line-height: 1.5;
      padding-left: 18px;
      position: relative;
    }
    .trust-list li::before {
      content: "";
      position: absolute;
      left: 4px; top: 7px;
      width: 4px; height: 4px;
      border-radius: 50%;
      background: var(--brand-light);
    }

    .redirect-note {
      font-size: 11px;
      color: var(--ink-4);
      line-height: 1.5;
      padding-top: 10px;
      border-top: 1px dashed var(--line);
    }
    .redirect-note code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      color: var(--ink-3);
      background: rgba(15, 23, 42, 0.04);
      padding: 1px 6px;
      border-radius: 4px;
      word-break: break-all;
    }

    .loading, .error-state {
      padding: 56px 28px;
      text-align: center;
    }
    .loading-spinner {
      width: 32px; height: 32px;
      margin: 0 auto 16px;
      border: 3px solid var(--brand-50);
      border-top-color: var(--brand);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { font-size: 13.5px; color: var(--ink-3); }

    .error-state {
      color: var(--red);
    }
    .error-state .error-icon {
      width: 40px; height: 40px;
      margin: 0 auto 12px;
      border-radius: 50%;
      background: var(--red-bg);
      display: flex; align-items: center; justify-content: center;
    }
    .error-state .error-icon svg { width: 22px; height: 22px; }
    .error-text { font-size: 14px; font-weight: 500; max-width: 360px; margin: 0 auto; line-height: 1.5; }

    /* Subtle entrance animation */
    main.card { animation: card-in 0.45s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes card-in {
      from { opacity: 0; transform: translateY(8px) scale(0.99); }
      to { opacity: 1; transform: none; }
    }

    @media (max-width: 480px) {
      body { padding: 16px 12px 48px; }
      main.card { border-radius: 16px; }
      .hero { padding: 28px 22px 20px; }
      .permissions { padding: 8px 18px; }
      .actions { padding: 20px 18px 8px; flex-direction: column-reverse; }
      .actions button { width: 100%; }
      footer.meta { padding: 18px 22px 22px; }
    }
  </style>
</head>
<body>
  <main class="card" id="root">
    <div class="loading">
      <div class="loading-spinner"></div>
      <div class="loading-text">Preparing authorization request\u2026</div>
    </div>
  </main>
  <script src="/oauth/consent.js" defer></script>
</body>
</html>`;
}

// Step 1 of the browser consent flow: serve the HTML shell.
// NO auth required on this route — the shell itself reads the JWT
// from localStorage and bounces to /login if missing.
router.get('/consent', async (req: Request, res: Response) => {
    const requestId = String(req.query.req || '');
    const stash = await loadAuthorizeRequest(requestId);
    if (!stash) {
        res.status(404).send('Authorize request not found or expired. Re-start the flow.');
        return;
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderConsentShellHtml());
});

// Static shell-script for the consent page (CSP-compliant: served from
// 'self' so `script-src-elem 'self'` accepts it; no inline JS needed).
// Cached aggressively because the content is static — reads request
// data from URL query params at runtime.
router.get('/consent.js', (_req: Request, res: Response) => {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(CONSENT_SHELL_JS);
});

// Step 2: the shell fetches consent metadata (JSON) with the BO JWT.
const ConsentDataQuerySchema = z.object({ req: z.string().trim().min(1) }).strict();

/**
 * Map a scope key (`operator.read`, `configuration.publish_sandbox`)
 * to UI-presentation metadata. Pulls displayName + description from
 * the canonical PERMISSION_TAXONOMY so we never drift, plus adds
 * scope-specific UX hints (family, mutationLevel, icon glyph) the
 * consent screen needs.
 */
type ScopeFamily = 'operator' | 'config';
type MutationLevel = 'read' | 'comm' | 'mutate' | 'admin';

interface ScopePresentation {
    scope: string;
    family: ScopeFamily;
    displayName: string;
    description: string;
    mutationLevel: MutationLevel;
    icon: string; // emoji-free glyph name; the client maps to an SVG.
}

const SCOPE_PRESENTATION_HINTS: Record<string, { family: ScopeFamily; mutationLevel: MutationLevel; icon: string }> = {
    'operator.read':                   { family: 'operator', mutationLevel: 'read',   icon: 'search' },
    'operator.comm':                   { family: 'operator', mutationLevel: 'comm',   icon: 'mail' },
    'operator.analytics':              { family: 'operator', mutationLevel: 'read',   icon: 'chart' },
    'operator.mutate':                 { family: 'operator', mutationLevel: 'mutate', icon: 'pencil' },
    'configuration.read':              { family: 'config',   mutationLevel: 'read',   icon: 'book' },
    'configuration.draft':             { family: 'config',   mutationLevel: 'mutate', icon: 'pencil' },
    'configuration.validate':          { family: 'config',   mutationLevel: 'read',   icon: 'check' },
    'configuration.simulate':          { family: 'config',   mutationLevel: 'read',   icon: 'flask' },
    'configuration.publish_sandbox':   { family: 'config',   mutationLevel: 'admin',  icon: 'rocket' },
};

/**
 * Effective permission keys for the consenting BO user.
 *
 * The consent handlers previously read `req.resolvedPermissions`, but that
 * is only populated by `requirePermission` middleware — which these routes
 * do not use — so it was ALWAYS empty here. Result: the defence-in-depth
 * gate on `operator.mutate` (ADR-0040 §6: the consenting user must hold it
 * themselves) could never pass for non-admins, even though UNDERWRITER's
 * baseline includes `operator.mutate`. Resolve for real: role baseline +
 * RBAC assignment overlays, cached on the request. On resolver failure we
 * fall back to [] — scopes degrade to "not grantable", never wider.
 */
interface ConsentUserContext {
    user?: { id?: string; role?: string | null };
    resolvedPermissions?: ResolvedPermission[];
}

async function resolveConsentUserPermissions(ctx: ConsentUserContext): Promise<string[]> {
    if (ctx.resolvedPermissions) return ctx.resolvedPermissions.map((p) => p.key);
    const userId = String(ctx.user?.id || '');
    if (!userId) return [];
    try {
        const resolved = await resolveEffectivePermissionsForUser(userId, ctx.user?.role);
        ctx.resolvedPermissions = resolved;
        return resolved.map((p) => p.key);
    } catch (err) {
        logger.warn({ err, userId }, 'mcp.oauth.consent.permission_resolution_failed');
        return [];
    }
}

function presentScope(scope: string): ScopePresentation {
    const hint = SCOPE_PRESENTATION_HINTS[scope];
    const def = ALL_PERMISSIONS.find((p) => `${p.resource}.${p.action}` === scope);
    return {
        scope,
        family: hint?.family ?? 'operator',
        displayName: def?.displayName ?? scope,
        description: def?.description ?? '',
        mutationLevel: hint?.mutationLevel ?? 'read',
        icon: hint?.icon ?? 'shield',
    };
}

router.get('/consent/data', authenticate, async (req: Request, res: Response) => {
    const parsed = ConsentDataQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: 'invalid_request', error_description: parsed.error.message });
        return;
    }
    const stash = await loadAuthorizeRequest(parsed.data.req);
    if (!stash) {
        res.status(404).json({ error: 'not_found', error_description: 'Authorize request expired.' });
        return;
    }
    const client = await findOAuthClientByClientId(stash.clientId);
    if (!client) {
        res.status(404).json({ error: 'not_found', error_description: 'Client no longer exists.' });
        return;
    }
    const userRole = String(req.user?.role || '');
    const userName = String(req.user?.name || '');
    const userPermissions = await resolveConsentUserPermissions(req);
    const decision = assertCanGrantScopes({
        role: userRole,
        userPermissions,
        requestedScopes: stash.requestedScopes,
    });
    const tenant = getTenantConfig();
    res.json({
        clientName: client.clientName,
        clientUri: client.clientUri,
        redirectUri: stash.redirectUri,
        // Enriched grantable list — each entry has displayName, description,
        // family ('operator' | 'config'), mutationLevel, and icon hint
        // for the premium consent UI.
        grantable: decision.grantable.map(presentScope),
        rejected: decision.rejected,
        userRole: userRole || 'BO user',
        userName: userName || null,
        tenantSlug: tenant.tenantSlug,
        tenantCountry: tenant.country,
    });
});

// ----------------------------------------------------------------------
// POST /oauth/consent/decision — emit code or redirect with error
// ----------------------------------------------------------------------

const ConsentDecisionBodySchema = z
    .object({
        req: z.string().trim().min(1),
        decision: z.enum(['allow', 'deny']),
    })
    .strict();

// The browser shell calls this via fetch() with the BO JWT in the
// Authorization header, so authenticate (strict 401-on-missing) is
// the right middleware. The handler returns { redirect_url } and the
// shell's JS does the actual navigation — keeps the redirect target
// transparent to the client and lets us cleanly surface validation
// errors without losing the OAuth client's redirect_uri.
router.post('/consent/decision', authenticate, async (req: Request, res: Response) => {
    const body = req.body;
    const parsedDecision = ConsentDecisionBodySchema.safeParse(body);
    if (!parsedDecision.success) {
        oauthError(res, 400, 'invalid_request', 'Invalid consent decision payload.');
        return;
    }
    const requestId = parsedDecision.data.req;
    const decision = parsedDecision.data.decision;
    const stash = await loadAuthorizeRequest(requestId);
    if (!stash) {
        oauthError(res, 404, 'not_found', 'Authorize request not found or expired.');
        return;
    }
    const userId = String(req.user?.id || '');
    if (!userId) {
        // authenticate populated nothing — shouldn't happen but fail loud.
        oauthError(res, 401, 'login_required', 'Login required.');
        return;
    }
    const userRole = String(req.user?.role || '');
    const userPermissions = await resolveConsentUserPermissions(req);

    if (decision !== 'allow') {
        await deleteAuthorizeRequest(requestId);
        void AuditLogger.log(
            stash.clientId,
            'OAUTH_CLIENT',
            'OAUTH.AUTHORIZATION_DENIED',
            `user:${userId}`,
            'USER',
            { clientId: stash.clientId, requestedScopes: stash.requestedScopes },
        );
        const redirect = new URL(stash.redirectUri);
        redirect.searchParams.set('error', 'access_denied');
        redirect.searchParams.set('state', stash.state);
        res.json({ redirect_url: redirect.toString() });
        return;
    }

    // Role-gated scope filtering (ADR-0040 §6).
    const grantDecision = assertCanGrantScopes({
        role: userRole,
        userPermissions,
        requestedScopes: stash.requestedScopes,
    });
    if (grantDecision.grantable.length === 0) {
        await deleteAuthorizeRequest(requestId);
        void AuditLogger.log(
            stash.clientId,
            'OAUTH_CLIENT',
            'OAUTH.AUTHORIZATION_DENIED',
            `user:${userId}`,
            'USER',
            { reason: 'no_grantable_scopes', rejected: grantDecision.rejected },
        );
        const redirect = new URL(stash.redirectUri);
        redirect.searchParams.set('error', 'access_denied');
        redirect.searchParams.set('error_description', 'No grantable scopes for this user role.');
        redirect.searchParams.set('state', stash.state);
        res.json({ redirect_url: redirect.toString() });
        return;
    }

    const { code } = await issueAuthorizationCode({
        clientId: stash.clientId,
        userId,
        operatingTenantId: stash.operatingTenantId,
        scopes: grantDecision.grantable,
        resource: stash.resource,
        redirectUri: stash.redirectUri,
        codeChallenge: stash.codeChallenge,
        codeChallengeMethod: 'S256',
        issuedAt: new Date().toISOString(),
    });
    await deleteAuthorizeRequest(requestId);

    void AuditLogger.log(
        stash.clientId,
        'OAUTH_CLIENT',
        'OAUTH.AUTHORIZATION_GRANTED',
        `user:${userId}`,
        'USER',
        {
            clientId: stash.clientId,
            userRole,
            grantedScopes: grantDecision.grantable,
            deniedScopes: grantDecision.rejected,
            resource: stash.resource,
        },
    );

    const redirect = new URL(stash.redirectUri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', stash.state);
    res.json({ redirect_url: redirect.toString() });
});

// ----------------------------------------------------------------------
// POST /oauth/token — code exchange OR refresh-token rotation
// ----------------------------------------------------------------------

const TokenBodySchema = z.discriminatedUnion('grant_type', [
    z.object({
        grant_type: z.literal('authorization_code'),
        code: z.string().trim().min(1),
        redirect_uri: z.string().trim().url(),
        client_id: z.string().trim().min(1),
        client_secret: z.string().trim().min(1).optional(),
        code_verifier: z.string().trim().min(43).max(128),
        resource: z.string().trim().url(),
    }),
    z.object({
        grant_type: z.literal('refresh_token'),
        refresh_token: z.string().trim().min(1),
        client_id: z.string().trim().min(1),
        client_secret: z.string().trim().min(1).optional(),
        scope: z.string().trim().optional(),
        resource: z.string().trim().url(),
    }),
]);

router.post('/token', async (req: Request, res: Response) => {
    const parsed = TokenBodySchema.safeParse(req.body);
    if (!parsed.success) {
        oauthError(res, 400, 'invalid_request', parsed.error.message);
        return;
    }
    const body = parsed.data;
    const resource = resolveResourceParameter(body.resource);
    if (!resource) {
        logger.warn(
            {
                clientId: body.client_id,
                grantType: body.grant_type,
                receivedResource: body.resource,
            },
            'mcp.oauth.token.invalid_target',
        );
        oauthError(res, 400, 'invalid_target', `resource must be a canonical MCP mount URL for this tenant; received "${body.resource}".`);
        return;
    }
    const { ok, client } = await verifyClientCredentials(body.client_id, body.client_secret ?? null);
    if (!ok || !client) {
        oauthError(res, 401, 'invalid_client', 'Client authentication failed.');
        return;
    }

    if (body.grant_type === 'authorization_code') {
        const payload = await consumeAuthorizationCode(body.code, {
            clientId: client.clientId,
            redirectUri: body.redirect_uri,
        });
        if (!payload) {
            oauthError(res, 400, 'invalid_grant', 'Authorization code invalid, expired, or reused.');
            return;
        }
        if (!verifyPkce(body.code_verifier, payload.codeChallenge)) {
            oauthError(res, 400, 'invalid_grant', 'PKCE verification failed.');
            return;
        }
        if (payload.resource !== resource.url) {
            oauthError(res, 400, 'invalid_target', 'resource does not match the authorization request.');
            return;
        }
        const access = await issueAccessToken({
            clientId: client.clientId,
            userId: payload.userId,
            operatingTenantId: client.operatingTenantId,
            resource: resource.url,
            scopes: payload.scopes,
            issuedAt: new Date().toISOString(),
        });
        const { rawToken: refreshToken } = await createRefreshToken({
            operatingTenantId: client.operatingTenantId,
            clientId: client.clientId,
            userId: payload.userId,
            scopes: payload.scopes,
            resource: resource.url,
        });
        void AuditLogger.log(
            client.id,
            'OAUTH_TOKEN',
            'OAUTH.TOKEN_ISSUED',
            `oauth_client:${client.clientId}`,
            'SYSTEM',
            {
                grantType: 'authorization_code',
                userId: payload.userId,
                scopes: payload.scopes,
                resource: resource.url,
                accessTokenBackend: access.backend,
            },
        );
        res.json({
            access_token: access.rawToken,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: refreshToken,
            scope: payload.scopes.join(' '),
        });
        return;
    }

    // grant_type === 'refresh_token'
    const existing = await findActiveRefreshToken(body.refresh_token);
    if (!existing || existing.clientId !== client.clientId) {
        oauthError(res, 400, 'invalid_grant', 'Refresh token invalid, expired, or rotated.');
        return;
    }
    if (existing.resource !== resource.url) {
        oauthError(res, 400, 'invalid_target', 'resource does not match the original grant.');
        return;
    }
    // Optional narrowing — the new token may have a subset of the
    // original scopes (RFC 6749 §6).
    const requestedScopes = body.scope ? parseScopeString(body.scope) : existing.scopes;
    const narrowedScopes = requestedScopes.filter((s) => existing.scopes.includes(s));
    if (narrowedScopes.length === 0) {
        oauthError(res, 400, 'invalid_scope', 'Requested scopes are not a subset of the original grant.');
        return;
    }
    await markRefreshTokenRotated(existing.id);
    const access = await issueAccessToken({
        clientId: client.clientId,
        userId: existing.userId,
        operatingTenantId: client.operatingTenantId,
        resource: resource.url,
        scopes: narrowedScopes,
        issuedAt: new Date().toISOString(),
    });
    const { rawToken: newRefresh } = await createRefreshToken({
        operatingTenantId: client.operatingTenantId,
        clientId: client.clientId,
        userId: existing.userId,
        scopes: narrowedScopes,
        resource: resource.url,
    });
    void AuditLogger.log(
        client.id,
        'OAUTH_TOKEN',
        'OAUTH.TOKEN_REFRESHED',
        `oauth_client:${client.clientId}`,
        'SYSTEM',
        {
            userId: existing.userId,
            scopes: narrowedScopes,
            resource: resource.url,
        },
    );
    res.json({
        access_token: access.rawToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: newRefresh,
        scope: narrowedScopes.join(' '),
    });
});

// ----------------------------------------------------------------------
// POST /oauth/revoke — RFC 7009
// ----------------------------------------------------------------------

const RevokeBodySchema = z
    .object({
        token: z.string().trim().min(1),
        token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
        client_id: z.string().trim().min(1),
        client_secret: z.string().trim().min(1).optional(),
    })
    .strict();

router.post('/revoke', async (req: Request, res: Response) => {
    const parsed = RevokeBodySchema.safeParse(req.body);
    if (!parsed.success) {
        oauthError(res, 400, 'invalid_request', parsed.error.message);
        return;
    }
    const body = parsed.data;
    const { ok, client } = await verifyClientCredentials(body.client_id, body.client_secret ?? null);
    if (!ok || !client) {
        // RFC 7009 §2.2 — clients SHOULD get 200 even if the token is
        // already invalid, to prevent enumeration. But unauthenticated
        // calls still get 401.
        oauthError(res, 401, 'invalid_client', 'Client authentication failed.');
        return;
    }
    if (body.token.startsWith('at_')) {
        await revokeAccessToken(body.token);
    } else if (body.token.startsWith('rt_')) {
        await revokeRefreshToken(body.token);
    }
    void AuditLogger.log(
        client.id,
        'OAUTH_TOKEN',
        'OAUTH.TOKEN_REVOKED',
        `oauth_client:${client.clientId}`,
        'SYSTEM',
        { tokenPrefix: body.token.slice(0, 3) },
    );
    res.status(200).end();
});

export const oauthFlowRouter = router;
