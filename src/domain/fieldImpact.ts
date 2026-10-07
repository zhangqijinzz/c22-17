import { makeId } from '../models/projectFactory';
import type {
  BusinessRule,
  FieldChangeKind,
  FieldImpactEntry,
  FieldImpactReview,
  FieldImpactSeverity,
  NumberRange,
  PredicateCondition,
  RuleCondition,
  RuleField,
  RuleProject,
  ScalarValue,
} from '../models/ruleModel';
import { conditionId, ensureConditionIds } from './conditionIdentity';

export interface FieldChangeProposal {
  kind: FieldChangeKind;
  fieldId: string;
  next?: RuleField;
}

export interface FieldImpactReport {
  kind: FieldChangeKind;
  field: RuleField;
  nextField?: RuleField;
  changeSummary: string[];
  totalConditions: number;
  affectedRuleCount: number;
  invalidCount: number;
  reviewCount: number;
  entries: FieldImpactEntry[];
}

interface CollectedCondition {
  rule: BusinessRule;
  condition: PredicateCondition;
  path: number[];
}

interface ImpactDecision {
  severity: FieldImpactSeverity;
  reasonCode: string;
  reason: string;
}

export function planFieldChange(project: RuleProject, proposal: FieldChangeProposal): FieldImpactReport | null {
  const field = project.fields.find((candidate) => candidate.id === proposal.fieldId);
  if (!field) return null;
  if (proposal.kind === 'delete') return buildReport('delete', field, undefined, ['字段将被删除，引用它的条件会保留为待修复条件'], project);
  const next = proposal.next;
  if (!next || next.id !== field.id || next.type !== field.type) return null;
  return buildReport('update', field, next, buildChangeSummary(field, next), project);
}

export function createFieldImpactReview(report: FieldImpactReport): FieldImpactReview {
  const id = makeId('impact-review');
  return {
    id,
    changeKind: report.kind,
    fieldId: report.field.id,
    fieldNameBefore: report.field.name,
    fieldNameAfter: report.nextField?.name,
    createdAt: Date.now(),
    changeSummary: report.changeSummary,
    entries: report.entries.map((entry) => ({ ...entry, reviewId: id })),
  };
}

export function flattenImpactEntries(reviews: FieldImpactReview[]): FieldImpactEntry[] {
  return reviews.flatMap((review) => review.entries);
}

export function confirmImpactEntry(project: RuleProject, entryId: string): RuleProject {
  const reviews = project.fieldImpactReviews
    .map((review) => ({ ...review, entries: review.entries.filter((entry) => entry.id !== entryId) }))
    .filter((review) => review.entries.length > 0);
  return reconcileImpactReviews({ ...project, fieldImpactReviews: reviews });
}

export function reconcileImpactReviews(project: RuleProject): RuleProject {
  const fieldById = new Map(project.fields.map((field) => [field.id, field]));
  const ruleById = new Map(project.rules.map((rule) => [rule.id, rule]));
  const reviews = project.fieldImpactReviews.flatMap((review) => {
    const entries = review.entries.filter((entry) => {
      const rule = ruleById.get(entry.ruleId);
      const condition = rule && findByPath(rule.conditions, entry.conditionPath);
      if (!rule || !condition || condition.cid !== entry.conditionId || condition.fieldId !== entry.fieldId) return false;
      const field = fieldById.get(entry.fieldId);
      if (entry.reasonCode === 'field-deleted') return !field;
      if (!field) return false;
      if (entry.reasonCode === 'enum-option-removed') {
        return field.type === 'enum' && typeof condition.value === 'string' && !(field.enumValues ?? []).includes(condition.value);
      }
      return true;
    });
    return entries.length ? [{ ...review, entries }] : [];
  });
  return { ...project, fieldImpactReviews: reviews };
}

export function normalizeProjectForImpact(project: RuleProject): RuleProject {
  const normalized = structuredClone(project);
  normalized.rules = ensureConditionIds(normalized.rules);
  normalized.fieldImpactReviews ??= [];
  return reconcileImpactReviews(normalized);
}

function buildReport(kind: FieldChangeKind, field: RuleField, nextField: RuleField | undefined, changeSummary: string[], project: RuleProject): FieldImpactReport {
  const reviewId = makeId('impact-review');
  const collected = collectConditions(project.rules, field.id);
  const entries = collected.flatMap((item) => {
    const decision = decideImpact(item.condition, field, nextField);
    if (!decision) return [];
    const id = item.condition.cid ?? conditionId(item.rule.id, item.path);
    return [{
      id: makeId('impact-entry'),
      reviewId,
      conditionId: id,
      conditionPath: item.path,
      fieldId: field.id,
      fieldName: nextField?.name ?? field.name,
      ruleId: item.rule.id,
      ruleName: item.rule.name,
      operator: item.condition.operator,
      value: cloneValue(item.condition.value),
      severity: decision.severity,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      before: describeField(field),
      after: nextField ? describeField(nextField) : '字段已删除',
    } satisfies FieldImpactEntry];
  });
  return {
    kind,
    field,
    nextField: nextField ? structuredClone(nextField) : undefined,
    changeSummary,
    totalConditions: collected.length,
    affectedRuleCount: new Set(entries.map((entry) => entry.ruleId)).size,
    invalidCount: entries.filter((entry) => entry.severity === 'invalid').length,
    reviewCount: entries.filter((entry) => entry.severity === 'review').length,
    entries,
  };
}

function collectConditions(rules: BusinessRule[], fieldId: string): CollectedCondition[] {
  return rules.flatMap((rule) => collectFromGroup(rule, rule.conditions, [], fieldId));
}

function collectFromGroup(rule: BusinessRule, group: BusinessRule['conditions'], path: number[], fieldId: string): CollectedCondition[] {
  return group.conditions.flatMap((condition, index) => {
    const nextPath = [...path, index];
    if (condition.kind === 'group') return collectFromGroup(rule, condition, nextPath, fieldId);
    return condition.fieldId === fieldId ? [{ rule, condition, path: nextPath }] : [];
  });
}

function decideImpact(condition: PredicateCondition, before: RuleField, after: RuleField | undefined): ImpactDecision | null {
  if (!after) return { severity: 'invalid', reasonCode: 'field-deleted', reason: '字段删除后，该条件引用的字段不存在，需要改选字段或移除条件' };
  const semantic = decideSemanticImpact(condition, before, after);
  if (semantic) return semantic;
  if (before.name !== after.name) return { severity: 'review', reasonCode: 'field-renamed', reason: `字段名称将从“${before.name}”改为“${after.name}”，请确认条件展示和业务含义仍正确` };
  return null;
}

function decideSemanticImpact(condition: PredicateCondition, before: RuleField, after: RuleField): ImpactDecision | null {
  if (before.type === 'number' && after.type === 'number') return decideNumberImpact(condition, before, after);
  if (before.type === 'enum' && after.type === 'enum') return decideEnumImpact(condition, before, after);
  return null;
}

function decideNumberImpact(condition: PredicateCondition, before: RuleField, after: RuleField): ImpactDecision | null {
  if (before.min === after.min && before.max === after.max) return null;
  const oldRange = finiteRange(before);
  const newRange = finiteRange(after);
  if (!oldRange || !newRange) return null;
  let oldMeasure = 0;
  let newMeasure = 0;
  if (condition.operator === 'between' && isNumberRange(condition.value)) {
    oldMeasure = numberIntersectionMeasure(condition, condition.value, oldRange);
    newMeasure = numberIntersectionMeasure(condition, condition.value, newRange);
  } else if (typeof condition.value === 'number') {
    const relationRange: NumberRange = condition.operator === 'gt' || condition.operator === 'gte'
      ? { min: condition.value, max: Infinity }
      : condition.operator === 'lt' || condition.operator === 'lte'
        ? { min: -Infinity, max: condition.value }
        : { min: condition.value, max: condition.value };
    oldMeasure = numberIntersectionMeasure(condition, relationRange, oldRange);
    newMeasure = numberIntersectionMeasure(condition, relationRange, newRange);
  }
  if (oldMeasure === newMeasure) return null;
  if (newMeasure === 0) return { severity: 'invalid', reasonCode: 'number-condition-outside-range', reason: '调整后的合法范围不再覆盖该阈值，条件会恒假或无法形成有效判断' };
  return { severity: 'review', reasonCode: 'number-range-changed', reason: '字段合法范围变化后，该条件可命中的输入空间已改变，请逐条确认' };
}

function decideEnumImpact(condition: PredicateCondition, before: RuleField, after: RuleField): ImpactDecision | null {
  const oldValues = before.enumValues ?? [];
  const newValues = after.enumValues ?? [];
  const removed = oldValues.filter((value) => !newValues.includes(value));
  const added = newValues.filter((value) => !oldValues.includes(value));
  if (typeof condition.value !== 'string') return null;
  if (removed.includes(condition.value)) {
    return condition.operator === 'eq'
      ? { severity: 'invalid', reasonCode: 'enum-option-removed', reason: `选项“${condition.value}”已删除，等于该选项的条件将无法再命中` }
      : { severity: 'review', reasonCode: 'enum-option-removed-inequality', reason: `选项“${condition.value}”已删除，不等于条件的取值边界发生变化，请确认` };
  }
  if (added.length && condition.operator === 'notEq') {
    return { severity: 'review', reasonCode: 'enum-option-added', reason: `新增选项 ${added.map((value) => `“${value}”`).join('、')} 后，“不等于”条件会对新增选项成立` };
  }
  return null;
}

function buildChangeSummary(before: RuleField, after: RuleField): string[] {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`名称：${before.name} → ${after.name}`);
  if (before.type === 'number' && after.type === 'number') {
    if (before.min !== after.min) changes.push(`最小值：${before.min ?? '-'} → ${after.min ?? '-'}`);
    if (before.max !== after.max) changes.push(`最大值：${before.max ?? '-'} → ${after.max ?? '-'}`);
  }
  if (before.type === 'enum' && after.type === 'enum') {
    const oldValues = before.enumValues ?? [];
    const newValues = after.enumValues ?? [];
    const removed = oldValues.filter((value) => !newValues.includes(value));
    const added = newValues.filter((value) => !oldValues.includes(value));
    if (removed.length) changes.push(`删除选项：${removed.join('、')}`);
    if (added.length) changes.push(`新增选项：${added.join('、')}`);
  }
  return changes.length ? changes : ['字段定义没有实质变化'];
}

function finiteRange(field: RuleField): NumberRange | null {
  return typeof field.min === 'number' && typeof field.max === 'number' && Number.isFinite(field.min) && Number.isFinite(field.max)
    ? { min: field.min, max: field.max }
    : null;
}

function numberIntersectionMeasure(condition: PredicateCondition, selected: NumberRange, fieldRange: NumberRange): number {
  const min = Math.max(selected.min, fieldRange.min);
  const max = Math.min(selected.max, fieldRange.max);
  if (min > max) return 0;
  if (min < max) return max - min;
  if (condition.operator === 'between') return 1;
  if (condition.operator === 'eq') return 1;
  if ((condition.operator === 'gte' || condition.operator === 'lte') && Number.isFinite(min)) return 1;
  return 0;
}

function findByPath(group: BusinessRule['conditions'], path: number[]): PredicateCondition | undefined {
  let current: RuleCondition = group;
  for (const index of path) {
    if (current.kind !== 'group') return undefined;
    const child: RuleCondition | undefined = current.conditions[index];
    if (!child) return undefined;
    current = child;
  }
  return current.kind === 'predicate' ? current : undefined;
}

function describeField(field: RuleField): string {
  if (field.type === 'number') return `${field.name}：${field.min ?? '-'} 至 ${field.max ?? '-'}`;
  if (field.type === 'enum') return `${field.name}：${(field.enumValues ?? []).join('、')}`;
  return `${field.name}：是 / 否`;
}

function isNumberRange(value: ScalarValue | NumberRange): value is NumberRange {
  return typeof value === 'object' && value !== null && 'min' in value && 'max' in value;
}

function cloneValue(value: ScalarValue | NumberRange): ScalarValue | NumberRange {
  return typeof value === 'object' ? structuredClone(value) : value;
}
