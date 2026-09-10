type Selector = { field: string; itemKey?: string; values: string[] };
type Scope = { version: 1; selectors: Selector[]; authorityIds?: string[] };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value)
  && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim());
const path = (value: unknown): value is string => typeof value === 'string'
  && value.trim() === value && value.split('.').every((part) => part && !['__proto__', 'prototype', 'constructor'].includes(part));
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));

function parseScope(value: unknown): Scope | null {
  if (!record(value) || !only(value, ['version', 'selectors', 'authorityIds']) || value.version !== 1 || !Array.isArray(value.selectors)) return null;
  if (value.authorityIds !== undefined && (!strings(value.authorityIds) || !value.authorityIds.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) return null;
  const selectors: Selector[] = [];
  for (const selector of value.selectors) {
    if (!record(selector) || !only(selector, ['field', 'itemKey', 'values']) || !path(selector.field)
      || !strings(selector.values) || (selector.itemKey !== undefined && !path(selector.itemKey))) return null;
    selectors.push({ field: selector.field, values: selector.values, ...(selector.itemKey === undefined ? {} : { itemKey: selector.itemKey }) });
  }
  return { version: 1, selectors, ...(value.authorityIds === undefined ? {} : { authorityIds: value.authorityIds }) };
}

function read(answers: Record<string, unknown>, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(answers, field)) return answers[field];
  return field.split('.').reduce<unknown>((value, key) => record(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, answers);
}
const normalize = (value: string) => value.trim().toLowerCase();

export function sourceQuestionScopeUnavailable(value: unknown, compilerError: unknown, binderProductAuthorityId?: string): boolean {
  if (compilerError !== undefined) return true;
  if (value === undefined) return false;
  const scope = parseScope(value);
  return !scope || Boolean(scope.authorityIds && !binderProductAuthorityId);
}

/** Read-only published-scope projection. Binder authority is supplied separately from answer data. */
export function isSourceQuestionScopeVisible(value: unknown, answers: Record<string, unknown>, binderProductAuthorityId?: string): boolean {
  if (value === undefined) return true;
  const scope = parseScope(value);
  if (!scope) return false;
  if (scope.authorityIds && (!binderProductAuthorityId || !scope.authorityIds.includes(binderProductAuthorityId))) return false;
  return scope.selectors.every((selector) => {
    const current = read(answers, selector.field);
    if (current === undefined || current === null || current === '' || (Array.isArray(current) && !current.length)) return true;
    const selected = selector.itemKey === undefined ? (Array.isArray(current) ? current : [current])
      : Array.isArray(current) ? current.map((row) => record(row) ? read(row, selector.itemKey!) : undefined) : [undefined];
    return selected.some((item) => typeof item === 'string' && selector.values.some((allowed) => normalize(allowed) === normalize(item)));
  });
}
