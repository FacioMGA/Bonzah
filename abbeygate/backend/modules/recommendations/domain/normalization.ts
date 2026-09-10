// InferenceFeatures type moved to types.ts; imported by consumers directly

export const ALLOWED_EXCESS = [250, 500, 750, 1000];

export class Normalizer {

    static getAgeBand(age: number | null): string {
        if (age === null || age === undefined || isNaN(age)) return 'unknown';
        if (age < 30) return '<30';
        if (age <= 44) return '30-44';
        if (age <= 59) return '45-59';
        if (age <= 69) return '60-69';
        return '70+';
    }

    static getValueBand(value: number | null): string {
        if (value === null || value === undefined || isNaN(value)) return 'unknown';
        if (value < 5000) return '<5k';
        if (value < 10000) return '5-10k';
        if (value < 20000) return '10-20k';
        return '20k+';
    }

    static getNcbBand(years: number | null): string {
        if (years === null || years === undefined || isNaN(years)) return 'unknown';
        if (years === 0) return '0';
        if (years <= 2) return '1-2';
        if (years <= 5) return '3-5';
        return '6+';
    }

    static normalizeCoverType(raw: string): string {
        if (!raw) return 'unknown';
        const clean = raw.trim().toLowerCase();
        if (clean.includes('comp')) return 'Comp';
        if (clean.includes('tpl') || clean.includes('third')) return 'TPL';
        return 'unknown';
    }

    static normalizeExcess(raw: unknown): number | null {
        const val = Number(raw);
        if (isNaN(val)) return null;

        // Argmin absolute difference
        let best = ALLOWED_EXCESS[0];
        let minDiff = Math.abs(val - best);

        for (const candidate of ALLOWED_EXCESS) {
            const diff = Math.abs(val - candidate);
            if (diff < minDiff) {
                minDiff = diff;
                best = candidate;
            }
            // Tie-breaker: prefer lower (implicit, as we iterate low->high and update only on strict <)
            // Actually spec says "Ties: choose the lower".
            // If we iterate sorted 250,500,750,1000.
            // 625 -> 500 diff 125, 750 diff 125.
            // If diff < minDiff : keeps 500. Correct.
        }
        return best;
    }

    static normalizeClaimProtection(raw: unknown): boolean {
        if (!raw) return false;
        const str = String(raw).toLowerCase().trim();
        if (['yes', 'y', 'true', '1'].includes(str)) return true;
        return false;
    }

    static generateBundleId(excess: number, claimProtection: boolean): string {
        return `EX${excess}_CP${claimProtection ? '1' : '0'}`;
    }
}
