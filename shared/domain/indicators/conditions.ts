import type { IntelligenceEvent } from '../types.ts';

/**
 * Declarative condition language for indicators (and, in Phase 4, alert rules).
 *
 * Deliberately NOT a scripting language: conditions are plain JSON over an
 * allow-listed set of event fields with a fixed set of operators, so a stored
 * condition can never execute code. Evaluation is total and side-effect free.
 */

export type Operator = 'eq' | 'neq' | 'in' | 'contains' | 'gte' | 'lte' | 'exists';

export type Leaf = { field: ConditionField; op: Operator; value?: string | number | boolean | (string | number)[] };
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition } | Leaf;

/** Fields a condition may reference, with how to read them from an event. */
export const CONDITION_FIELDS = {
  category: (e: IntelligenceEvent) => e.category,
  regionIds: (e: IntelligenceEvent) => e.regionIds,
  countryCodes: (e: IntelligenceEvent) => e.countryCodes,
  credibility: (e: IntelligenceEvent) => e.credibility,
  sourceId: (e: IntelligenceEvent) => e.sourceId,
  sourceClass: (e: IntelligenceEvent) => e.sourceClass,
  title: (e: IntelligenceEvent) => e.title,
  locationPrecision: (e: IntelligenceEvent) => e.locationPrecision,
  'metadata.change': (e: IntelligenceEvent) => e.metadata?.change,
  'metadata.subtype': (e: IntelligenceEvent) => e.metadata?.subtype,
  'metadata.routine': (e: IntelligenceEvent) => e.metadata?.routine,
  'metadata.advisoryLevel': (e: IntelligenceEvent) => e.metadata?.advisoryLevel,
  'metadata.previousLevel': (e: IntelligenceEvent) => e.metadata?.previousLevel,
  'metadata.knownRansomwareUse': (e: IntelligenceEvent) => e.metadata?.knownRansomwareUse,
  'metadata.seismicType': (e: IntelligenceEvent) => e.metadata?.seismicType,
  'metadata.alertLevel': (e: IntelligenceEvent) => e.metadata?.alertLevel,
  'metadata.magnitude': (e: IntelligenceEvent) => e.metadata?.magnitude,
  'metadata.outageCause': (e: IntelligenceEvent) => e.metadata?.outageCause,
  'metadata.tfrType': (e: IntelligenceEvent) => e.metadata?.tfrType,
  'metadata.declarationType': (e: IntelligenceEvent) => e.metadata?.declarationType,
} as const;

export type ConditionField = keyof typeof CONDITION_FIELDS;
const OPERATORS: Operator[] = ['eq', 'neq', 'in', 'contains', 'gte', 'lte', 'exists'];

const norm = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);

function testLeaf(leaf: Leaf, e: IntelligenceEvent): boolean {
  // Own-property lookup only: never resolve inherited names like 'constructor'.
  if (!Object.hasOwn(CONDITION_FIELDS, leaf.field)) return false;
  const actual: unknown = CONDITION_FIELDS[leaf.field](e);
  const expected = leaf.value;
  switch (leaf.op) {
    case 'exists':
      return actual !== undefined && actual !== null && !(Array.isArray(actual) && actual.length === 0);
    case 'eq':
      return Array.isArray(actual) ? actual.some((a) => norm(a) === norm(expected)) : norm(actual) === norm(expected);
    case 'neq':
      return Array.isArray(actual) ? !actual.some((a) => norm(a) === norm(expected)) : norm(actual) !== norm(expected);
    case 'in': {
      const set = (Array.isArray(expected) ? expected : [expected]).map(norm);
      return Array.isArray(actual) ? actual.some((a) => set.includes(norm(a))) : set.includes(norm(actual));
    }
    case 'contains':
      if (Array.isArray(actual)) return actual.some((a) => norm(a) === norm(expected));
      return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
  }
}

export function matches(cond: Condition, e: IntelligenceEvent): boolean {
  if ('all' in cond) return cond.all.every((c) => matches(c, e));
  if ('any' in cond) return cond.any.some((c) => matches(c, e));
  if ('not' in cond) return !matches(cond.not, e);
  return testLeaf(cond, e);
}

/** Structural validation; returns a list of problems (empty = valid). */
export function validateCondition(cond: unknown, path = 'match', depth = 0): string[] {
  if (depth > 6) return [`${path}: nested too deeply`];
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) return [`${path}: must be an object`];
  const c = cond as Record<string, unknown>;
  const keys = Object.keys(c);
  for (const group of ['all', 'any'] as const) {
    if (group in c) {
      if (keys.length !== 1) return [`${path}: "${group}" must be the only key`];
      if (!Array.isArray(c[group]) || (c[group] as unknown[]).length === 0) return [`${path}.${group}: must be a non-empty array`];
      return (c[group] as unknown[]).flatMap((x, i) => validateCondition(x, `${path}.${group}[${i}]`, depth + 1));
    }
  }
  if ('not' in c) return keys.length === 1 ? validateCondition(c.not, `${path}.not`, depth + 1) : [`${path}: "not" must be the only key`];
  const problems: string[] = [];
  if (!(typeof c.field === 'string' && Object.hasOwn(CONDITION_FIELDS, c.field))) problems.push(`${path}: unknown field ${String(c.field)}`);
  if (!OPERATORS.includes(c.op as Operator)) problems.push(`${path}: unknown operator ${String(c.op)}`);
  if (c.op !== 'exists' && c.value === undefined) problems.push(`${path}: operator ${String(c.op)} needs a value`);
  if ((c.op === 'gte' || c.op === 'lte') && typeof c.value !== 'number') problems.push(`${path}: ${String(c.op)} needs a number`);
  const extra = keys.filter((k) => !['field', 'op', 'value'].includes(k));
  if (extra.length) problems.push(`${path}: unexpected keys ${extra.join(', ')}`);
  return problems;
}

const OP_TEXT: Record<Operator, string> = {
  eq: '=', neq: '≠', in: 'IN', contains: 'CONTAINS', gte: '≥', lte: '≤', exists: 'EXISTS',
};

/** Human-readable rendering, e.g. `sourceId = cisa-kev AND metadata.routine ≠ true`. */
export function describeCondition(cond: Condition): string {
  if ('all' in cond) return cond.all.map((c) => wrap(c)).join(' AND ');
  if ('any' in cond) return cond.any.map((c) => wrap(c)).join(' OR ');
  if ('not' in cond) return `NOT ${wrap(cond.not)}`;
  const v = Array.isArray(cond.value) ? `[${cond.value.join(', ')}]` : cond.value === undefined ? '' : ` ${String(cond.value)}`;
  return `${cond.field} ${OP_TEXT[cond.op]}${cond.op === 'in' ? ` ${v.trim()}` : v}`;
}

function wrap(c: Condition): string {
  return 'all' in c || 'any' in c ? `(${describeCondition(c)})` : describeCondition(c);
}
