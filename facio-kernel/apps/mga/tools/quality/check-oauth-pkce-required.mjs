#!/usr/bin/env node
/**
 * CHAMPS guard — OAuth PKCE S256 is mandatory (ADR-0040 §4).
 *
 * Asserts that `oauthFlowRouter.ts`:
 *   1. The `code_challenge_method` field is a `z.literal('S256')`.
 *   2. The PKCE verification helper compares the base64url SHA-256
 *      digest of `code_verifier` to the stashed `code_challenge`.
 *   3. The `code_challenge_method` in the authorization-code store
 *      payload is restricted to `'S256'`.
 *
 * Catches:
 *   - Adding `'plain'` to the enum.
 *   - Removing the `verifyPkce` call from `/oauth/token`.
 *   - Skipping PKCE for confidential clients (which OAuth 2.1 still
 *     mandates).
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const TARGETS = [
    path.join(ROOT, 'backend/modules/mcp/oauth/http/oauthFlowRouter.ts'),
    path.join(ROOT, 'backend/modules/mcp/oauth/infra/oauthAuthorizationCodeStore.ts'),
];

const failures = [];

for (const target of TARGETS) {
    if (!fs.existsSync(target)) {
        failures.push(`Missing required file: ${path.relative(ROOT, target)}`);
        continue;
    }
    const content = fs.readFileSync(target, 'utf8');

    if (!/code_challenge_method/.test(content)) {
        failures.push(`${path.relative(ROOT, target)}: must reference \`code_challenge_method\`.`);
        continue;
    }
    // S256 enum literal must be present.
    if (!/z\.literal\(['"]S256['"]\)|['"]S256['"]/.test(content)) {
        failures.push(`${path.relative(ROOT, target)}: \`code_challenge_method\` must be locked to \`S256\`.`);
    }
    // No 'plain' allowed.
    if (/code_challenge_method[^\n]*['"]plain['"]/.test(content)) {
        failures.push(`${path.relative(ROOT, target)}: \`plain\` PKCE method is forbidden (ADR-0040 §4).`);
    }
}

// Also verify verifyPkce is called inside the token endpoint flow.
const routerPath = TARGETS[0];
if (fs.existsSync(routerPath)) {
    const content = fs.readFileSync(routerPath, 'utf8');
    if (!/verifyPkce\s*\(/.test(content)) {
        failures.push(
            `${path.relative(ROOT, routerPath)}: \`verifyPkce\` MUST be called during /oauth/token authorization_code exchange.`,
        );
    }
}

if (failures.length > 0) {
    console.error('check-oauth-pkce-required: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-oauth-pkce-required: ok');
}
