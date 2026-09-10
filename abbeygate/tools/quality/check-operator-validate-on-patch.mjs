#!/usr/bin/env node
/**
 * CHAMPS guard — applyQuotePatchUseCase must call validateForContext
 * (ADR-0039 — the validation seam).
 *
 * Asserts that
 * `backend/modules/policy/app/quoteLifecycle/applyQuotePatchUseCase.ts`:
 *
 *   1. Imports `validateForContext` from `@facio/validation/backend`.
 *   2. Calls it with `actor: 'underwriter'`.
 *   3. Does so BEFORE any `tx.policy.update` or `policyStateCurrent.upsert`
 *      that writes the merged quoteData.
 *
 * This is the single backend caller of `validateForContext({ actor:
 * 'underwriter' })`. If the import or the call disappears, V2's whole
 * mutation safety story disappears with it.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const TARGET = path.join(
    ROOT,
    'backend/modules/policy/app/quoteLifecycle/applyQuotePatchUseCase.ts',
);

const failures = [];

if (!fs.existsSync(TARGET)) {
    failures.push(`Missing required file: ${path.relative(ROOT, TARGET)}`);
} else {
    const content = fs.readFileSync(TARGET, 'utf8');

    if (!/from\s+['"]@facio\/validation\/backend['"]/.test(content)) {
        failures.push(
            `${path.relative(ROOT, TARGET)}: must import \`validateForContext\` from \`@facio/validation/backend\`.`,
        );
    }
    if (!/validateForContext\s*\(/.test(content)) {
        failures.push(`${path.relative(ROOT, TARGET)}: must CALL \`validateForContext(...)\`.`);
    }
    if (!/actor:\s*['"]underwriter['"]/.test(content)) {
        failures.push(
            `${path.relative(ROOT, TARGET)}: \`validateForContext\` call must include \`actor: 'underwriter'\` per ADR-0039 §"validation seam".`,
        );
    }
    const validateIdx = content.search(/validateForContext\s*\(/);
    const writeIdx = content.search(/tx\.(policy|policyStateCurrent)\.(update|upsert|create)/);
    if (validateIdx >= 0 && writeIdx >= 0 && validateIdx > writeIdx) {
        failures.push(
            `${path.relative(ROOT, TARGET)}: \`validateForContext\` must run BEFORE Prisma writes (currently at index ${validateIdx} vs write at ${writeIdx}).`,
        );
    }
}

if (failures.length > 0) {
    console.error('check-operator-validate-on-patch: violations detected');
    console.error('');
    for (const f of failures) console.error(`  ${f}`);
    if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
    console.log('check-operator-validate-on-patch: ok');
}
