
import type { SlugDef, RuleOp } from './types.js';
import type { MagicBContext } from './types.js';

import { logger } from '../../../../platform/utils/logger.js';
interface LoadedRule {
    id: string;
    slug: string;
    ruleBody: RuleOp;
    contextFilter: unknown;
    severity: string;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRuleOp(value: unknown): value is RuleOp {
    const v = asRecord(value);
    const op = String(v.op || '');
    if (op === 'required') return true;
    if ((op === 'gt' || op === 'lt' || op === 'min_length') && typeof v.value === 'number') return true;
    if (op === 'one_of' && Array.isArray(v.values) && v.values.every((x) => typeof x === 'string')) return true;
    if (op === 'regex' && typeof v.pattern === 'string') return true;
    return false;
}

class MagicBRegistry {
    private slugs: Map<string, SlugDef> = new Map();
    private rules: LoadedRule[] = [];
    private indexedRulesByToken: Map<string, LoadedRule[]> = new Map();
    private unindexedRules: LoadedRule[] = [];
    private isLoaded = false;
    private parseDotPath(pathRaw: unknown): string[] | undefined {
        const raw = String(pathRaw || '').trim();
        if (!raw) return undefined;
        const parts = raw.split('.').map((p) => p.trim()).filter(Boolean);
        if (!parts.length) return undefined;
        // Prevent prototype-chain access. We only support plain object traversal.
        const deny = new Set(['__proto__', 'prototype', 'constructor']);
        for (const p of parts) {
            if (deny.has(p)) return undefined;
        }
        return parts;
    }

    private readonly indexableContextKeys = new Set([
        'tenantId',
        'binderId',
        'binderSectionId',
        'workflowStep',
        'region',
        'streamType',
    ]);

    private tokenForContext(key: string, value: unknown) {
        return `${key}=${String(value)}`;
    }

    private extractIndexTokens(filter: unknown): string[] {
        if (!filter) return [];
        if (typeof filter !== 'object') return [];
        const filterRecord = filter as Record<string, unknown>;

        // Complex boolean logic => skip indexing (still evaluated by conditionsMatch later).
        if ('any' in filterRecord || 'not' in filterRecord) return [];

        if ('all' in filterRecord && Array.isArray(filterRecord.all)) {
            // Union of AND parts; safe superset.
            const out: string[] = [];
            for (const sf of filterRecord.all) {
                out.push(...this.extractIndexTokens(sf));
            }
            return out;
        }

        const out: string[] = [];
        for (const [k, v] of Object.entries(filterRecord)) {
            if (k === 'effective_from' || k === 'effective_to') continue;
            if (!this.indexableContextKeys.has(k)) continue;
            if (v === null || v === undefined) continue;
            const t = typeof v;
            if (t === 'string' || t === 'number' || t === 'boolean') {
                out.push(this.tokenForContext(k, v));
            }
        }
        return out;
    }

    /**
     * Hydrates the registry with data fetched externally (e.g. by the app-layer loader).
     * This keeps the domain class free of Prisma imports.
     */
    hydrate(data: {
        slugs: Record<string, unknown>[];
        mappings: Record<string, unknown>[];
        rules: Record<string, unknown>[];
    }) {
        if (this.isLoaded) return;
        logger.info('🔮 MagicB: Loading Registry...');

        // 1. Slugs + Storage Mappings (for binding)
        const { slugs: dbSlugs, mappings: dbMappings, rules: dbRules } = data;
        this.slugs.clear();
        dbSlugs.forEach((slug: Record<string, unknown>) => {
            const mapping = dbMappings.find((mp: Record<string, unknown>) => mp.slug === slug.slug);
            const binding =
                String(mapping?.bindingType || '').toUpperCase() === 'COLUMN' && mapping?.columnName
                    ? { type: 'column' as const, value: String(mapping.columnName) }
                    : String(mapping?.bindingType || '').toUpperCase() === 'JSONB_PATH' && mapping?.jsonPath
                        ? { type: 'json_path' as const, value: String(mapping.jsonPath) }
                        : undefined;

            this.slugs.set(String(slug.slug), {
                slug: String(slug.slug),
                dataType: String(slug.dataType) as SlugDef['dataType'],
                title: String(slug.title || ''),
                binding,
                bindingPathParts: binding?.type === 'json_path' ? this.parseDotPath(binding.value) : undefined,
            });
        });

        // 2. Rules
        this.rules = dbRules.map((rule: Record<string, unknown>) => ({
            id: String(rule.id),
            slug: String(rule.slug),
            ruleBody: isRuleOp(rule.ruleBody) ? rule.ruleBody : { op: 'required' },
            contextFilter: rule.contextFilter,
            severity: String(rule.severity)
        }));

        // 3. Build lightweight index (superset) for common context keys.
        this.indexedRulesByToken.clear();
        this.unindexedRules = [];
        for (const rule of this.rules) {
            const tokens = this.extractIndexTokens(rule.contextFilter);
            if (!tokens.length) {
                this.unindexedRules.push(rule);
                continue;
            }
            for (const t of tokens) {
                const arr = this.indexedRulesByToken.get(t) || [];
                arr.push(rule);
                this.indexedRulesByToken.set(t, arr);
            }
        }

        this.isLoaded = true;
        logger.info(`🔮 MagicB: Loaded ${this.slugs.size} slugs and ${this.rules.length} rules.`);
    }

    getSlug(slug: string): SlugDef | undefined {
        return this.slugs.get(slug);
    }

    getRulesforSlug(slug: string): LoadedRule[] {
        return this.rules.filter(r => r.slug === slug);
    }

    getAllRules(): LoadedRule[] {
        return this.rules;
    }

    /**
     * Return a deterministic superset of rules likely to match the context.
     * Still requires full `conditionsMatch()` filtering in the engine.
     */
    getCandidateRules(context: MagicBContext): LoadedRule[] {
        const outById = new Map<string, LoadedRule>();

        for (const r of this.unindexedRules) outById.set(r.id, r);

        for (const k of this.indexableContextKeys) {
            const v = asRecord(context)[k];
            if (v === undefined || v === null || v === '') continue;
            const token = this.tokenForContext(k, v);
            const arr = this.indexedRulesByToken.get(token);
            if (!arr) continue;
            for (const r of arr) outById.set(r.id, r);
        }

        // Deterministic ordering for auditability.
        return Array.from(outById.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
}

export const Registry = new MagicBRegistry();
