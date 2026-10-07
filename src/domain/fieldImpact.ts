import type {
  FieldImpactReport,
  FieldImpactReview,
  ImpactChange,
  ImpactedCondition,
  ImpactedRuleSummary,
  ImpactSeverity,
  NumberRange,
  PredicateCondition,
  RuleCondition,
  RuleField,
  RuleProject,
} from '../models/ruleModel';

export interface FieldChangeDraft {
  nextField?: RuleField;
  delete?: boolean;
}

export function planFieldImpact(project: RuleProject, fieldId: string, draft: FieldChangeDraft): FieldImpactReport {
  const field = project.fields.find((candidate) => candidate.id === fieldId);
  if (!field) throw new Error(`字段 ${fieldId} 不存在`);

  if (draft.delete) return buildReport(project, field, undefined, 'delete');
  const nextField = draft.nextField;
  if (!nextField) throw new Error(`字段 ${fieldId} 缺少变更内容`);
  return buildReport(project, field, nextField, 'update');
}

function buildReport(project: RuleProject, field: RuleField, nextField: RuleField | undefined, action: 'update' | 'delete'): FieldImpactReport {
  const changes = action === 'delete' ? describeDeletion(field) : describeChanges(field, nextField as RuleField);
  const semanticChange = action === 'delete' || changes.length > 0;
  const conditions: ImpactedCondition[] = [];

  project.rules.forEach((rule) => {
    collectConditions(rule.conditions, [], (condition, path) => {
      if (condition.fieldId !== field.id) return;
      const analysis = action === 'delete'
        ? analyzeDeleted(rule.id, field, condition, rule.name, path)
        : semanticChange
          ? withReference(rule.id, rule.name, path, analyzeCondition(field, nextField as RuleField, condition))
          : withReference(rule.id, rule.name, path, baseStatic(field, condition, 'reference-only', 'info', '字段显示名称以外的定义未变化，条件继续按原字段判断。'));
      conditions.push(analysis);
    });
  });

  const sorted = conditions.sort(compareConditions);
  const summariesByRule = new Map<string, ImpactedRuleSummary>();
  for (const condition of sorted) {
    const existing = summariesByRule.get(condition.ruleId) ?? {
      ruleId: condition.ruleId,
      ruleName: condition.ruleName,
      conditionCount: 0,
      warningCount: 0,
      invalidCount: 0,
    };
    existing.conditionCount += 1;
    if (condition.severity === 'warning') existing.warningCount += 1;
    if (condition.severity === 'invalid') existing.invalidCount += 1;
    summariesByRule.set(condition.ruleId, existing);
  }

  return {
    action,
    fieldId: field.id,
    fieldName: action === 'delete' ? field.name : (nextField as RuleField).name,
    nextField,
    changes,
    impactedRules: [...summariesByRule.values()],
    conditions: sorted,
    counts: {
      rules: summariesByRule.size,
      conditions: sorted.length,
      info: sorted.filter((condition) => condition.severity === 'info').length,
      warning: sorted.filter((condition) => condition.severity === 'warning').length,
      invalid: sorted.filter((condition) => condition.severity === 'invalid').length,
    },
  };
}

export function createImpactReview(report: FieldImpactReport): FieldImpactReview {
  return {
    id: makeReviewId(),
    fieldId: report.fieldId,
    fieldName: report.fieldName,
    action: report.action,
    changedAt: Date.now(),
    changes: report.changes,
    conditions: report.conditions,
    acknowledgedConditionKeys: [],
  };
}

export function reconcileImpactReviews(project: RuleProject): FieldImpactReview[] {
  return (project.impactReviews ?? []).flatMap((review) => {
    const activeConditions: ImpactedCondition[] = [];
    const acknowledgedKeys = new Set<string>();

    for (const entry of [...review.conditions].sort((left, right) => left.path.join('.').localeCompare(right.path.join('.')))) {
      const rule = project.rules.find((candidate) => candidate.id === entry.ruleId);
      if (!rule) continue;
      const usedPaths = new Set(activeConditions.filter((condition) => condition.ruleId === entry.ruleId).map((condition) => condition.path.join('.')));
      const match = findUnmatchedPredicate(rule.conditions, [], entry.fieldId, entry.signature, usedPaths);
      if (!match) continue;
      const nextKey = `${entry.ruleId}::${match.path.join('.')}::${entry.signature}`;
      if (review.acknowledgedConditionKeys.includes(reviewConditionKey(entry))) acknowledgedKeys.add(nextKey);
      activeConditions.push({ ...entry, path: match.path, ruleName: rule.name });
    }

    if (!activeConditions.length) return [];
    return [{ ...review, conditions: activeConditions, acknowledgedConditionKeys: [...acknowledgedKeys] }];
  });
}

export function reviewConditionKey(condition: ImpactedCondition): string {
  return `${condition.ruleId}::${condition.path.join('.')}::${condition.signature}`;
}

function findUnmatchedPredicate(
  condition: RuleCondition,
  path: number[],
  fieldId: string,
  signature: string,
  usedPaths: Set<string>,
): { condition: PredicateCondition; path: number[] } | undefined {
  if (condition.kind === 'predicate') {
    const key = path.join('.');
    return condition.fieldId === fieldId && conditionSignature(condition) === signature && !usedPaths.has(key)
      ? { condition, path }
      : undefined;
  }
  for (let index = 0; index < condition.conditions.length; index += 1) {
    const match = findUnmatchedPredicate(condition.conditions[index], [...path, index], fieldId, signature, usedPaths);
    if (match) return match;
  }
  return undefined;
}

function analyzeDeleted(ruleId: string, field: RuleField, condition: PredicateCondition, ruleName: string, path: number[]): ImpactedCondition {
  return withReference(
    ruleId,
    ruleName,
    path,
    baseStatic(field, condition, 'field-deleted', 'invalid', `字段“${field.name}”已删除，这个条件无法继续取值，必须改选字段或移除。`),
  );
}

function analyzeCondition(before: RuleField, after: RuleField, condition: PredicateCondition): Omit<ImpactedCondition, 'ruleId' | 'ruleName' | 'path'> {
  return classifyCondition(before, after, condition);
}

function withReference(
  ruleId: string,
  ruleName: string,
  path: number[],
  condition: Omit<ImpactedCondition, 'ruleId' | 'ruleName' | 'path'>,
): ImpactedCondition {
  return { ...condition, ruleId, ruleName, path };
}

function classifyCondition(before: RuleField, after: RuleField, condition: PredicateCondition): Omit<ImpactedCondition, 'ruleId' | 'ruleName' | 'path'> {
  if (before.type === 'number' && after.type === 'number') return classifyNumber(before, after, condition);
  if (before.type === 'enum' && after.type === 'enum') return classifyEnum(before, after, condition);
  return baseStatic(before, condition, 'reference-only', 'info', '字段显示名称以外的定义未变化，条件继续按原字段判断。');
}

function classifyNumber(before: RuleField, after: RuleField, condition: PredicateCondition): Omit<ImpactedCondition, 'ruleId' | 'ruleName' | 'path'> {
  const oldMin = finiteOr(before.min, -Infinity);
  const oldMax = finiteOr(before.max, Infinity);
  const newMin = finiteOr(after.min, -Infinity);
  const newMax = finiteOr(after.max, Infinity);

  if (condition.operator === 'between' && isRange(condition.value)) {
    const { min, max } = condition.value;
    const overlaps = min <= newMax && max >= newMin;
    const contained = min >= newMin && max <= newMax;
    if (!overlaps) return baseStatic(after, condition, 'impossible', 'warning', `合法范围变为 ${describeBounds(newMin, newMax)}，区间 ${formatNumber(min)} 至 ${formatNumber(max)} 已没有交集，条件不会成立。`);
    if (!contained) return baseStatic(after, condition, 'scope-partial', 'warning', `区间 ${formatNumber(min)} 至 ${formatNumber(max)} 只有部分值落在新范围 ${describeBounds(newMin, newMax)} 内，请确认边界是否仍符合业务含义。`);
    if (newMin !== oldMin || newMax !== oldMax) return baseStatic(after, condition, 'scope-changed', 'warning', '条件仍可成立；字段取值空间变化后，该区间命中的输入可能改变，请逐条确认。');
    return baseStatic(after, condition, 'reference-only', 'info', '字段定义未发生影响取值的变化。');
  }

  const value = typeof condition.value === 'number' ? condition.value : Number.NaN;
  if (!Number.isFinite(value)) return baseStatic(after, condition, 'invalid-value', 'invalid', '现有条件值不是有效数值，请重新填写。');

  switch (condition.operator) {
    case 'gt':
      if (value >= newMax) return baseStatic(after, condition, 'impossible', 'warning', `合法值最大为 ${formatNumber(newMax)}，不满足大于 ${formatNumber(value)}，条件不会成立。`);
      if (value < newMin) return baseStatic(after, condition, 'always-true', 'warning', `新的最小值 ${formatNumber(newMin)} 已满足条件，当前规则会因此恒成立。`);
      break;
    case 'gte':
      if (value > newMax) return baseStatic(after, condition, 'impossible', 'warning', `所有合法值都不大于等于 ${formatNumber(value)}，条件不会成立。`);
      if (value <= newMin) return baseStatic(after, condition, 'always-true', 'warning', `新的最小值 ${formatNumber(newMin)} 已满足条件，当前规则会因此恒成立。`);
      break;
    case 'lt':
      if (value <= newMin) return baseStatic(after, condition, 'impossible', 'warning', `合法值最小为 ${formatNumber(newMin)}，不满足小于 ${formatNumber(value)}，条件不会成立。`);
      if (value > newMax) return baseStatic(after, condition, 'always-true', 'warning', `新的最大值 ${formatNumber(newMax)} 已满足条件，当前规则会因此恒成立。`);
      break;
    case 'lte':
      if (value < newMin) return baseStatic(after, condition, 'impossible', 'warning', `所有合法值都不小于等于 ${formatNumber(value)}，条件不会成立。`);
      if (value >= newMax) return baseStatic(after, condition, 'always-true', 'warning', `新的最大值 ${formatNumber(newMax)} 已满足条件，当前规则会因此恒成立。`);
      break;
    case 'eq':
      if (value < newMin || value > newMax) return baseStatic(after, condition, 'impossible', 'warning', `等于 ${formatNumber(value)} 在新范围内没有可选取值，条件不会成立。`);
      break;
    default:
      break;
  }

  if (newMin !== oldMin || newMax !== oldMax) {
    return baseStatic(after, condition, 'scope-changed', 'warning', '条件值仍在新范围内；字段可取值空间调整可能改变规则命中，请逐条确认。');
  }
  return baseStatic(after, condition, 'reference-only', 'info', '字段定义未发生影响取值的变化。');
}

function classifyEnum(before: RuleField, after: RuleField, condition: PredicateCondition): Omit<ImpactedCondition, 'ruleId' | 'ruleName' | 'path'> {
  if (typeof condition.value !== 'string') return baseStatic(after, condition, 'invalid-value', 'invalid', '现有条件值不是有效选项，请重新选择。');
  const beforeValues = before.enumValues ?? [];
  const afterValues = after.enumValues ?? [];
  if (!afterValues.includes(condition.value)) {
    return baseStatic(after, condition, 'invalid-value', 'invalid', `选项“${condition.value}”已从“${after.name}”中移除，请改选现有选项或删除条件。`);
  }
  if (beforeValues.length !== afterValues.length || beforeValues.some((value, index) => value !== afterValues[index])) {
    return baseStatic(after, condition, 'scope-changed', 'warning', '条件值仍在选项中；枚举集合已调整，请确认 notEq 等条件的业务含义。');
  }
  return baseStatic(after, condition, 'reference-only', 'info', '字段定义未发生影响取值的变化。');
}

function baseStatic(
  field: RuleField,
  condition: PredicateCondition,
  state: ImpactedCondition['state'],
  severity: ImpactSeverity,
  reason: string,
): Omit<ImpactedCondition, 'ruleId' | 'ruleName' | 'path'> {
  return {
    fieldId: field.id,
    fieldName: field.name,
    operator: condition.operator,
    valueText: formatConditionValue(condition),
    state,
    severity,
    reason,
    signature: conditionSignature(condition),
  };
}

function describeDeletion(field: RuleField): ImpactChange[] {
  return [{ key: 'delete', label: '字段', before: `${field.name} · ${fieldTypeLabel(field)}`, after: '删除' }];
}

function describeChanges(before: RuleField, after: RuleField): ImpactChange[] {
  const changes: ImpactChange[] = [];
  if (before.name.trim() !== after.name.trim()) changes.push({ key: 'name', label: '字段名称', before: before.name || '未命名', after: after.name || '未命名' });
  if (before.type !== after.type) changes.push({ key: 'type', label: '字段类型', before: fieldTypeLabel(before), after: fieldTypeLabel(after) });
  if (before.type === 'number' && after.type === 'number') {
    if (formatBoundary(before.min) !== formatBoundary(after.min)) changes.push({ key: 'min', label: '最小值', before: formatBoundary(before.min), after: formatBoundary(after.min) });
    if (formatBoundary(before.max) !== formatBoundary(after.max)) changes.push({ key: 'max', label: '最大值', before: formatBoundary(before.max), after: formatBoundary(after.max) });
  }
  if (before.type === 'enum' && after.type === 'enum') {
    const beforeValues = before.enumValues ?? [];
    const afterValues = after.enumValues ?? [];
    if (beforeValues.join('|') !== afterValues.join('|')) {
      changes.push({ key: 'enumValues', label: '可选值', before: formatList(beforeValues), after: formatList(afterValues) });
    }
  }
  return changes;
}

function collectConditions(condition: RuleCondition, path: number[], visit: (condition: PredicateCondition, path: number[]) => void): void {
  if (condition.kind === 'predicate') {
    visit(condition, path);
    return;
  }
  condition.conditions.forEach((child, index) => collectConditions(child, [...path, index], visit));
}

function compareConditions(left: ImpactedCondition, right: ImpactedCondition): number {
  return severityRank(right.severity) - severityRank(left.severity)
    || left.ruleId.localeCompare(right.ruleId)
    || left.path.join('.').localeCompare(right.path.join('.'));
}

function severityRank(severity: ImpactSeverity): number {
  return severity === 'invalid' ? 3 : severity === 'warning' ? 2 : 1;
}

function conditionSignature(condition: PredicateCondition): string {
  return `${condition.kind}:${condition.fieldId}:${condition.operator}:${typeof condition.value === 'object' ? `${condition.value.min}..${condition.value.max}` : String(condition.value)}`;
}

function isRange(value: PredicateCondition['value']): value is NumberRange {
  return typeof value === 'object' && value !== null && 'min' in value && 'max' in value;
}

function formatConditionValue(condition: PredicateCondition): string {
  if (condition.operator === 'between' && isRange(condition.value)) return `${formatNumber(condition.value.min)} 至 ${formatNumber(condition.value.max)}`;
  if (typeof condition.value === 'boolean') return condition.value ? '是' : '否';
  return String(condition.value);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function describeBounds(min: number, max: number): string {
  return `${formatNumber(min)} 至 ${formatNumber(max)}`;
}

function formatBoundary(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : '未设置';
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  return Number.isInteger(value) ? String(value) : String(value);
}

function formatList(values: string[]): string {
  return values.length ? values.join('、') : '（空）';
}

function fieldTypeLabel(field: RuleField): string {
  return field.type === 'number' ? '数值' : field.type === 'enum' ? '枚举' : '布尔';
}

function makeReviewId(): string {
  return `impact-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
