/**
 * Parity test — ensure `KNOWN_MOTOR_UW_THRESHOLD_KEYS` (consumed by
 * `validateDraft.ts` reference checks) stays in sync with the canonical
 * `MotorUwConfig.thresholds` shape in
 * `backend/products/motor/underwriting/motorUwAutomation.ts`.
 *
 * Production code outside the per-product engine zone is forbidden by
 * `tools/quality/check-product-engine-contract.mjs` from importing
 * `motorUwAutomation` directly. Test files are exempt — this test is
 * the spine that keeps the hand-typed mirror honest. If a new threshold
 * is added to the Motor UW fixture thresholds, this test
 * fails and forces the configuration module's mirror to update.
 */
import { describe, expect, it } from 'vitest';
import { MOTOR_UW_CONFIG_FIXTURE } from '../../../test/fixtures/motor/underwriting.js';
import { KNOWN_MOTOR_UW_REFERRAL_FLAG_KEYS, KNOWN_MOTOR_UW_THRESHOLD_KEYS } from '../domain/uwThresholdKeys.js';

describe('KNOWN_MOTOR_UW_THRESHOLD_KEYS parity', () => {
    it('mirrors every key in the Motor UW fixture thresholds exactly', () => {
        const canonical = new Set(Object.keys(MOTOR_UW_CONFIG_FIXTURE.thresholds));
        const mirrored = new Set(KNOWN_MOTOR_UW_THRESHOLD_KEYS);
        const missingFromMirror = [...canonical].filter((k) => !mirrored.has(k));
        const extraInMirror = [...mirrored].filter((k) => !canonical.has(k));
        expect({ missingFromMirror, extraInMirror }).toEqual({
            missingFromMirror: [],
            extraInMirror: [],
        });
    });

    it('mirrors every key in the Motor UW fixture referral flags exactly', () => {
        const canonical = new Set(Object.keys(MOTOR_UW_CONFIG_FIXTURE.referralFlags));
        const mirrored = new Set(KNOWN_MOTOR_UW_REFERRAL_FLAG_KEYS);
        const missingFromMirror = [...canonical].filter((k) => !mirrored.has(k));
        const extraInMirror = [...mirrored].filter((k) => !canonical.has(k));
        expect({ missingFromMirror, extraInMirror }).toEqual({
            missingFromMirror: [],
            extraInMirror: [],
        });
    });
});
