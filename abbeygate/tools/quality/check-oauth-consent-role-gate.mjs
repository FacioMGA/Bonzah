#!/usr/bin/env node
/**
 * CHAMPS guard — OAuth consent role gate (ADR-0040 §6).
 *
 * Asserts that every consent decision handler in the OAuth flow router
 * calls `assertCanGrantScopes` BEFORE issuing an authorization code.
 * Without that helper, a non-admin BO user could approve
 * `configuration.*` scopes — violating the role separation locked in
 * ADR-0040.
 *
 * Implementation: scan `backend/modules/mcp/oauth/http/oauthFlowRouter.ts`
 * for routes whose path includes `/oauth/consent` AND that call
 * `issueAuthorizationCode`. Each such handler MUST also call
 * `assertCanGrantScopes`.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const TARGET = path.join(ROOT, 'backend/modules/mcp/oauth/http/oauthFlowRouter.ts');

const failures = [];

if (!fs.existsSync(TARGET)) {
    failures.push(`Missing ${path.relative(ROOT, TARGET)}`);
} else {
    const content = fs.readFileSync(TARGET, 'utf8');

    // The consent decision handler must import and call assertCanGrantScopes.
    if (!/import\s*\{[^}]*assertCanGrantScopes[^}]*\}/.test(content)) {
        failures.push(
            `${path.relative(ROOT, TARGET)}: must import \`assertCanGrantScopes\` from accessControl/domain/permissionTaxonomy.`,
        );
    }
    const callCount = (content.match(/assertCanGrantScopes\s*\(/g) || []).length;
    if (callCount < 2) {
        // We expect at least 2 call sites: one inside GET /oauth/consent
        // (for displaying which scopes are grantable) and one inside
        // POST /oauth/consent/decision (the actual gate before issuing
        // a code).
        failures.push(
            `${path.relative(ROOT, TARGET)}: \`assertCanGrantScopes\` must be called inside BOTH the consent screen (display) and the decision endpoint (gate). Found ${callCount} call site(s).`,
        );
    }
    // Defense-in-depth: the decision endpoint must call assertCanGrantScopes
    // BEFORE issueAuthorizationCode in source order.
    const assertIdx = content.lastIndexOf('assertCanGrantScopes(');
    const issueIdx = content.indexOf('issueAuthorizationCode(');
    if (assertIdx >= 0 && issueIdx >= 0 && assertIdx > issueIdx) {
        failures.push(
            `${path.relative(ROOT, TARGET)}: \`assertCanGrantScopes\` must be called BEFORE issueAuthorizationCode (currently in the wrong order).`,
        );
    }
}

if (failures.length > 0) {
    console.error('check-oauth-consent-role-gate: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-oauth-consent-role-gate: ok');
}
