import type { BusinessRule, PredicateCondition, RuleCondition } from '../models/ruleModel';
import { makeId } from '../models/projectFactory';

export function conditionId(ruleId: string, path: number[]): string {
  return `${ruleId}:condition:${path.join('.')}`;
}

export function findPredicate(rules: BusinessRule[], conditionIdValue: string, path: number[]): PredicateCondition | undefined {
  const [ruleId] = conditionIdValue.split(':condition:');
  const rule = rules.find((candidate) => candidate.id === ruleId);
  if (!rule) return undefined;
  let current: RuleCondition = rule.conditions;
  for (const index of path) {
    if (current.kind !== 'group') return undefined;
    const child: RuleCondition | undefined = current.conditions[index];
    if (!child) return undefined;
    current = child;
  }
  return current.kind === 'predicate' ? current : undefined;
}

export function ensureConditionIds<T extends BusinessRule[]>(rules: T): T {
  for (const rule of rules) ensureConditionGroupIds(rule.id, rule.conditions, []);
  return rules;
}

function ensureConditionGroupIds(ruleId: string, group: BusinessRule['conditions'], path: number[]): void {
  group.conditions.forEach((condition, index) => {
    const nextPath = [...path, index];
    if (condition.kind === 'group') {
      ensureConditionGroupIds(ruleId, condition, nextPath);
      return;
    }
    if (!condition.cid) condition.cid = conditionId(ruleId, nextPath);
  });
}

export function newConditionId(): string {
  return makeId('condition');
}
