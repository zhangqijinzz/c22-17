import type { BusinessRule, RuleCondition, RuleField, RuleProject, ValidationIssue } from '../models/ruleModel';

export function validateField(field: RuleField): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!field.name.trim()) issues.push({ code: 'field-name', fieldId: field.id, message: '字段名称不能为空' });
  if (field.type === 'number') {
    if (!Number.isFinite(field.min) || !Number.isFinite(field.max)) {
      issues.push({ code: 'number-range-required', fieldId: field.id, message: `${field.name || '数值字段'}需要设置起点和终点` });
    } else if ((field.min as number) > (field.max as number)) {
      issues.push({ code: 'number-range-order', fieldId: field.id, message: `${field.name}的起点不能大于终点` });
    }
  }
  if (field.type === 'enum') {
    const values = (field.enumValues ?? []).map((value) => value.trim()).filter(Boolean);
    if (values.length === 0) issues.push({ code: 'enum-values-required', fieldId: field.id, message: `${field.name || '枚举字段'}至少需要一个选项` });
    if (new Set(values).size !== values.length) issues.push({ code: 'enum-values-duplicate', fieldId: field.id, message: `${field.name}的枚举值不能重复` });
  }
  return issues;
}

export function validateProject(project: RuleProject): ValidationIssue[] {
  const issues = project.fields.flatMap(validateField);
  const fieldIds = new Set(project.fields.map((field) => field.id));
  const fieldById = new Map(project.fields.map((field) => [field.id, field]));
  if (!project.title.trim()) issues.push({ code: 'project-title', message: '项目名称不能为空' });
  if (project.rules.length === 0) issues.push({ code: 'no-rules', message: '还没有规则，添加规则后才能执行完整性检查' });
  const ruleNames = new Set<string>();
  for (const rule of project.rules) {
    if (!rule.name.trim()) issues.push({ code: 'rule-name', ruleId: rule.id, message: '规则名称不能为空' });
    if (ruleNames.has(rule.name.trim())) issues.push({ code: 'duplicate-rule-name', ruleId: rule.id, message: `规则名称“${rule.name}”重复` });
    ruleNames.add(rule.name.trim());
    if (!Number.isFinite(rule.priority)) issues.push({ code: 'rule-priority', ruleId: rule.id, message: `${rule.name}的优先级无效` });
    if (!rule.result.trim()) issues.push({ code: 'rule-result', ruleId: rule.id, message: `${rule.name}需要填写结果` });
    validateCondition(rule.conditions, rule, fieldById, fieldIds, issues, []);
  }
  return issues;
}

function validateCondition(
  condition: RuleCondition,
  rule: BusinessRule,
  fieldById: Map<string, RuleField>,
  fieldIds: Set<string>,
  issues: ValidationIssue[],
  path: number[],
): void {
  const issueBase = { ruleId: rule.id, conditionId: condition.kind === 'predicate' ? condition.cid : undefined, conditionPath: path };
  if (condition.kind === 'group') {
    if (condition.conditions.length === 0) issues.push({ ...issueBase, code: 'empty-condition', message: `规则“${rule.name}”至少需要一个条件` });
    condition.conditions.forEach((child, index) => validateCondition(child, rule, fieldById, fieldIds, issues, [...path, index]));
    return;
  }
  const field = fieldById.get(condition.fieldId);
  if (!fieldIds.has(condition.fieldId) || !field) {
    issues.push({ ...issueBase, fieldId: condition.fieldId, code: 'missing-field', message: `规则“${rule.name}”引用了已删除的字段，请改选字段或移除该条件` });
    return;
  }
  if (field.type === 'number') {
    const numericOperator = ['eq', 'gt', 'gte', 'lt', 'lte'].includes(condition.operator);
    const isRange = typeof condition.value === 'object' && condition.value !== null && 'min' in condition.value && 'max' in condition.value;
    if (condition.operator === 'between' && isRange) {
      if (typeof condition.value.min !== 'number' || typeof condition.value.max !== 'number') issues.push({ ...issueBase, fieldId: field.id, code: 'condition-type', message: `规则“${rule.name}”的数值区间无效` });
      else if (condition.value.min > condition.value.max) issues.push({ ...issueBase, fieldId: field.id, code: 'condition-range-order', message: `规则“${rule.name}”的区间起点大于终点` });
    } else if (!numericOperator || typeof condition.value !== 'number') {
      issues.push({ ...issueBase, fieldId: field.id, code: 'condition-type', message: `规则“${rule.name}”的数值条件类型不匹配` });
    }
    return;
  }
  if (field.type === 'enum') {
    if ((condition.operator !== 'eq' && condition.operator !== 'notEq') || typeof condition.value !== 'string') {
      issues.push({ ...issueBase, fieldId: field.id, code: 'condition-type', message: `规则“${rule.name}”的枚举条件类型不匹配` });
    } else if (!(field.enumValues ?? []).includes(condition.value)) {
      issues.push({ ...issueBase, fieldId: field.id, code: 'condition-enum', message: `规则“${rule.name}”的条件值不在字段“${field.name}”的枚举选项中` });
    }
    return;
  }
  if ((condition.operator !== 'isTrue' && condition.operator !== 'isFalse') || typeof condition.value !== 'boolean') {
    issues.push({ ...issueBase, fieldId: field.id, code: 'condition-type', message: `规则“${rule.name}”的布尔条件类型不匹配` });
  }
}
