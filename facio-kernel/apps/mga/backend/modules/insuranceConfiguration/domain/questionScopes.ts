import { z } from 'zod';
import type { SymphonyProductConfiguration } from './productConfiguration.js';
import { sourceConfigurationAdapter } from './sourceAdapters.js';

export const binderScopeSchema = z.object({ binderId: z.string().uuid(), name: z.string().min(1), authorityIds: z.array(z.string().uuid()).min(1) }).strict();
export const binderScopesSchema = z.array(binderScopeSchema).superRefine((rows, ctx) => {
  const ids = rows.map((row) => row.binderId), authorities = rows.flatMap((row) => row.authorityIds);
  if (new Set(ids).size !== ids.length || new Set(authorities).size !== authorities.length) ctx.addIssue({ code: 'custom', message: 'Binder scope identities and authority IDs must be distinct.' });
});
export type BinderScope = z.infer<typeof binderScopeSchema>;
export const compiledQuestionScopeSchema = z.object({
  version: z.literal(1),
  selectors: z.array(z.object({ field: z.string().min(1), itemKey: z.string().min(1).optional(), values: z.array(z.string().min(1)).min(1) }).strict()),
  authorityIds: z.array(z.string().uuid()).min(1).optional(),
}).strict();
export type CompiledQuestionScope = z.infer<typeof compiledQuestionScopeSchema>;
export type ScopeCompilation = { productType: string; binders: BinderScope[] };
const scopeFields = ['coverage', 'binder', 'segment', 'section'] as const;
const normalized = (value: string) => value.trim().toLowerCase();
export function scopeTokens(value: string | undefined): string[] {
  const tokens = (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  return !tokens.length || tokens.some((part) => normalized(part) === 'all') ? [] : [...new Set(tokens)];
}

/** Symphony questionGroupScopeGuardrails: explicit group fields cascade, including All; absent fields preserve each question. */
export function inheritQuestionGroupScopes(product: SymphonyProductConfiguration): SymphonyProductConfiguration {
  return { ...product, details: { ...product.details, proposalQuestionGroups: product.details.proposalQuestionGroups.map((group) => ({ ...group, questions: group.questions.map((question) => {
    const inherited = { ...question };
    for (const field of scopeFields) if (group[field] !== undefined) inherited[field] = group[field]!.trim() || 'All';
    return inherited;
  }) })) } };
}

export function compileQuestionScope(product: SymphonyProductConfiguration, question: SymphonyProductConfiguration['details']['proposalQuestionGroups'][number]['questions'][number], context: ScopeCompilation): CompiledQuestionScope | undefined {
  const scopes = Object.fromEntries(scopeFields.map((field) => [field, scopeTokens(question[field])])) as Record<typeof scopeFields[number], string[]>;
  if (scopeFields.every((field) => !scopes[field].length)) return undefined;
  const selectors: CompiledQuestionScope['selectors'] = [];
  const adapter = sourceConfigurationAdapter(context.productType)?.questionScopes;
  const resolve = (tokens: string[], rows: { names: string[]; values: string[] }[], label: string): string[] => {
    const values: string[] = [];
    for (const token of tokens) {
      const matches = rows.filter((row) => row.names.some((name) => normalized(name) === normalized(token)));
      if (!matches.length) throw new Error(`Question ${question.slug}: unknown ${label} scope ${token}. Select a configured identifier.`);
      values.push(...matches.flatMap((row) => row.values));
    }
    return [...new Set(values)].sort();
  };
  if (scopes.coverage.length || scopes.section.length) {
    if (!adapter?.coverage) throw new Error(`Question ${question.slug}: coverage/section scopes require a registered product selector.`);
    const coverages = product.coverageSections.map((section) => ({ section, name: section.coverageName || section.classOfBusinessLabel || section.classOfBusinessKey }));
    if (scopes.coverage.length) selectors.push({ ...adapter.coverage, values: resolve(scopes.coverage, coverages.map(({ name }) => ({ names: [name], values: [name] })), 'coverage') });
    if (scopes.section.length) selectors.push({ ...adapter.coverage, values: resolve(scopes.section, coverages.map(({ section, name }) => ({ names: [section.sectionLabel || section.classOfBusinessKey], values: [name] })), 'section') });
  }
  if (scopes.segment.length) {
    if (!adapter?.segment) throw new Error(`Question ${question.slug}: segment scopes require a registered product selector.`);
    const segments = sourceConfigurationAdapter(context.productType)?.questionSegments?.(product) ?? [];
    // Registered segment ids are unambiguous; names are display labels, never an alternative identity.
    selectors.push({ ...adapter.segment, values: resolve(scopes.segment, segments.map((row) => ({ names: [row.id], values: [row.id] })), 'segment') });
  }
  let authorityIds: string[] | undefined;
  if (scopes.binder.length) {
    authorityIds = [];
    for (const token of scopes.binder) {
      const byId = context.binders.filter((row) => row.binderId === token);
      const matches = byId.length ? byId : context.binders.filter((row) => normalized(row.name) === normalized(token));
      if (matches.length !== 1) throw new Error(`Question ${question.slug}: binder scope ${token} must identify one active binder linked to this tenant programme; use its immutable ID when names repeat.`);
      authorityIds.push(...matches[0].authorityIds);
    }
    authorityIds = [...new Set(authorityIds)].sort();
  }
  return compiledQuestionScopeSchema.parse({ version: 1, selectors, ...(authorityIds ? { authorityIds } : {}) });
}

function readPath(answers: unknown, path: string): unknown {
  if (answers && typeof answers === 'object' && Object.hasOwn(answers, path)) return (answers as Record<string, unknown>)[path];
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' && !['__proto__', 'prototype', 'constructor'].includes(key) && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined, answers);
}
/** Same empty-filter semantics as Symphony. Identity comes only from retained server context. */
export function matchesQuestionScope(scope: CompiledQuestionScope, answers: unknown, authorityId: string): boolean {
  if (scope.authorityIds && !scope.authorityIds.includes(authorityId)) return false;
  return scope.selectors.every((selector) => {
    const value = readPath(answers, selector.field);
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return true;
    const selected = selector.itemKey ? (Array.isArray(value) ? value.map((row) => readPath(row, selector.itemKey!)) : []) : (Array.isArray(value) ? value : [value]);
    return selected.some((item) => typeof item === 'string' && selector.values.some((allowed) => normalized(allowed) === normalized(item)));
  });
}
