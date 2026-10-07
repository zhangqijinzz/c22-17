import { describe, expect, it } from 'vitest';
import { createImpactReview, planFieldImpact, reconcileImpactReviews, reviewConditionKey } from './fieldImpact';
import type { RuleProject } from '../models/ruleModel';

const tier: RuleProject['fields'][number] = { id: 'tier', name: '会员等级', type: 'enum', enumValues: ['普通', '银卡', '金卡'] };
const amount: RuleProject['fields'][number] = { id: 'amount', name: '订单金额', type: 'number', min: 0, max: 1000 };

function project(): RuleProject {
  return {
    id: 'project',
    title: '影响分析测试',
    fields: [tier, amount],
    sampleInputs: {},
    versions: [],
    updatedAt: 1,
    rules: [
      {
        id: 'gold-rule',
        name: '金卡规则',
        priority: 10,
        result: '通过',
        conditions: { kind: 'group', operator: 'and', conditions: [
          { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: '金卡' },
          { kind: 'predicate', fieldId: 'amount', operator: 'gte', value: 900 },
          { kind: 'predicate', fieldId: 'amount', operator: 'between', value: { min: 100, max: 200 } },
        ] },
      },
      {
        id: 'silver-rule',
        name: '银卡规则',
        priority: 20,
        result: '复核',
        conditions: { kind: 'group', operator: 'and', conditions: [
          { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: '银卡' },
        ] },
      },
    ],
  };
}

describe('field impact analysis', () => {
  it('lists every condition when an enum option is removed without collapsing the report', () => {
    const report = planFieldImpact(project(), 'tier', {
      nextField: { id: 'tier', name: '会员等级', type: 'enum', enumValues: ['普通', '金卡'] },
    });
    expect(report.counts.rules).toBe(2);
    expect(report.counts.conditions).toBe(2);
    expect(report.counts.invalid).toBe(1);
    expect(report.counts.warning).toBe(1);
    expect(report.conditions.map((condition) => condition.ruleName)).toContain('银卡规则');
    expect(report.conditions.map((condition) => condition.state)).toContain('invalid-value');
  });

  it('distinguishes impossible comparisons, always-true comparisons, and out-of-range interval values', () => {
    const narrowed = planFieldImpact(project(), 'amount', {
      nextField: { id: 'amount', name: '订单金额', type: 'number', min: 100, max: 800 },
    });
    const states = Object.fromEntries(narrowed.conditions.map((condition) => [condition.valueText, condition.state]));
    expect(states['900']).toBe('impossible');
    expect(states['100 至 200']).toBe('scope-changed');

    const tightened = planFieldImpact(project(), 'amount', {
      nextField: { id: 'amount', name: '订单金额', type: 'number', min: 150, max: 800 },
    });
    const partialInterval = tightened.conditions.find((condition) => condition.operator === 'between');
    expect(partialInterval?.severity).toBe('warning');
    expect(partialInterval?.state).toBe('scope-partial');

    const broadened = planFieldImpact(project(), 'amount', {
      nextField: { id: 'amount', name: '订单金额', type: 'number', min: 950, max: 2000 },
    });
    const gte = broadened.conditions.find((condition) => condition.operator === 'gte');
    expect(gte?.state).toBe('always-true');
  });

  it('keeps display-only renames as independently reviewable references', () => {
    const report = planFieldImpact(project(), 'tier', {
      nextField: { id: 'tier', name: '客户等级', type: 'enum', enumValues: ['普通', '银卡', '金卡'] },
    });
    expect(report.counts.conditions).toBe(2);
    expect(report.conditions.every((condition) => condition.severity === 'info')).toBe(true);
  });

  it('reports all predicate references before deleting a field', () => {
    const report = planFieldImpact(project(), 'amount', { delete: true });
    expect(report.action).toBe('delete');
    expect(report.counts.conditions).toBe(2);
    expect(report.conditions.every((condition) => condition.state === 'field-deleted')).toBe(true);
  });

  it('reconciles reviews when a rule condition is changed or removed', () => {
    const source = project();
    const report = planFieldImpact(source, 'tier', {
      nextField: { id: 'tier', name: '会员等级', type: 'enum', enumValues: ['普通', '金卡'] },
    });
    const review = createImpactReview(report);
    const withReview: RuleProject = { ...source, impactReviews: [review] };
    const changed: RuleProject = {
      ...withReview,
      rules: withReview.rules.map((rule) => rule.id === 'silver-rule'
        ? { ...rule, conditions: { kind: 'group' as const, operator: 'and' as const, conditions: [{ kind: 'predicate' as const, fieldId: 'tier', operator: 'eq' as const, value: '金卡' }] } }
        : rule),
    };
    expect(reconcileImpactReviews(changed)[0].conditions).toHaveLength(1);

    const removed: RuleProject = {
      ...withReview,
      rules: withReview.rules.map((rule) => rule.id === 'gold-rule'
        ? { ...rule, conditions: { ...rule.conditions, conditions: rule.conditions.conditions.filter((condition) => condition.kind === 'predicate' && condition.fieldId !== 'tier') } }
        : rule),
    };
    expect(reconcileImpactReviews(removed)[0].conditions).toHaveLength(1);
  });

  it('uses a stable condition key for acknowledgement across rendering cycles', () => {
    const report = planFieldImpact(project(), 'tier', { delete: true });
    expect(reviewConditionKey(report.conditions[0])).toBe(`${report.conditions[0].ruleId}::0::${report.conditions[0].signature}`);
  });
});
