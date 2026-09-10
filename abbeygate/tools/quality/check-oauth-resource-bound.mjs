#!/usr/bin/env node
/**
 * CHAMPS guard — OAuth tokens MUST be bound to a `resource` (ADR-0040 §8).
 *
 * Per RFC 8707, every issued OAuth access token / refresh token in our
 * MCP surface carries a `resource` value identifying the MCP mount it
 * may be presented at. Stripping the `resource` parameter would let an
 * operator-scope token be presented at the config mount (or vice
 * versa) — the cross-resource leak we explicitly forbid.
 *
 * Asserts:
 *   1. `resolveResourceParameter` is called inside /oauth/authorize.
 *   2. `resolveResourceParameter` is called inside /oauth/token.
 *   3. `oauthAccessTokenStore.ts` requires a `resource` field on the
 *      stored payload (non-optional).
 *   4. `oauthClientRepository.ts` createRefreshToken requires `resource`.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();

const ROUTER = path.join(ROOT, 'backend/modules/mcp/oauth/http/oauthFlowRouter.ts');
const ACCESS_STORE = path.join(ROOT, 'backend/modules/mcp/oauth/infra/oauthAccessTokenStore.ts');
const REPO = path.join(ROOT, 'backend/modules/mcp/oauth/infra/oauthClientRepository.ts');

const failures = [];

if (!fs.existsSync(ROUTER)) {
    failures.push(`Missing ${path.relative(ROOT, ROUTER)}`);
} else {
    const content = fs.readFileSync(ROUTER, 'utf8');
    const resolveCount = (content.match(/resolveResourceParameter\s*\(/g) || []).length;
    if (resolveCount < 2) {
        failures.push(
            `${path.relative(ROOT, ROUTER)}: \`resolveResourceParameter\` must be called from BOTH /oauth/authorize AND /oauth/token (found ${resolveCount} call site(s)).`,
        );
    }
    if (!/resource:\s*z\.string\(\)\.trim\(\)\.url\(\)/.test(content)) {
        failures.push(
            `${path.relative(ROOT, ROUTER)}: \`resource\` parameter must be a required z.string().trim().url() on authorize + token schemas.`,
        );
    }
}

if (fs.existsSync(ACCESS_STORE)) {
    const content = fs.readFileSync(ACCESS_STORE, 'utf8');
    // Look for required (non-optional) resource field in the payload type.
    if (!/resource:\s*string;/.test(content)) {
        failures.push(
            `${path.relative(ROOT, ACCESS_STORE)}: AccessTokenPayload.resource must be a required string.`,
        );
    }
}

if (fs.existsSync(REPO)) {
    const content = fs.readFileSync(REPO, 'utf8');
    if (!/createRefreshToken/.test(content)) {
        failures.push(`${path.relative(ROOT, REPO)}: missing createRefreshToken — has the OAuth flow regressed?`);
    } else if (!/resource:\s*string;/.test(content)) {
        failures.push(
            `${path.relative(ROOT, REPO)}: refresh-token storage must require a \`resource: string\` field.`,
        );
    }
}

if (failures.length > 0) {
    console.error('check-oauth-resource-bound: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-oauth-resource-bound: ok');
}
