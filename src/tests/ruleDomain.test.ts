import { describe, expect, it } from 'vitest';
import { evaluateSample } from '../domain/conditionEvaluator';
import { validateField, validateProject } from '../domain/fieldValidation';
import { analyzeRules } from '../domain/ruleAnalysis';
import { ensureConditionIds } from '../domain/conditionIdentity';
import { confirmImpactEntry, createFieldImpactReview, planFieldChange } from '../domain/fieldImpact';
import type { BusinessRule, RuleField, RuleProject } from '../models/ruleModel';

const amount: RuleField = { id: 'amount', name: '金额', type: 'number', min: 0, max: 1000 };
const tier: RuleField = { id: 'tier', name: '等级', type: 'enum', enumValues: ['basic', 'gold'] };
const active: RuleField = { id: 'active', name: '启用', type: 'boolean' };

function makeRule(id: string, conditions: BusinessRule['conditions'], priority = 10, result = id): BusinessRule {
  return { id, name: id, conditions, priority, result };
}

function project(rules: BusinessRule[], fields: RuleField[] = [amount, tier, active]): RuleProject {
  ensureConditionIds(rules);
  return { id: 'p', title: '测试项目', fields, rules, sampleInputs: {}, versions: [], fieldImpactReviews: [], updatedAt: 1 };
}

const amountAtLeast = (value: number): BusinessRule['conditions'] => ({ kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'gte', value }] });

describe('field and project validation', () => {
  it('accepts inclusive boundary ranges and rejects reversed or empty definitions', () => {
    expect(validateField({ ...amount, min: 5, max: 5 })).toEqual([]);
    expect(validateField({ ...amount, min: 11, max: 10 }).map((issue) => issue.code)).toContain('number-range-order');
    expect(validateField({ id: 'tier', name: '等级', type: 'enum', enumValues: [] }).map((issue) => issue.code)).toContain('enum-values-required');
  });

  it('checks enum and boolean predicate types without depending on React', () => {
    const rules = [
      makeRule('gold', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' }] }),
      makeRule('active', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'active', operator: 'isTrue', value: true }] }),
    ];
    expect(validateProject(project(rules))).toEqual([]);
    expect(evaluateSample(project(rules), { amount: 12, tier: 'gold', active: true }).matchedRules.map((rule) => rule.id)).toEqual(['gold', 'active']);
  });
});

describe('rule consistency analysis', () => {
  it('finds partial overlap, same-priority conflicts, lower-priority shadowing, unreachable rules, and gaps', () => {
    const rules = [
      makeRule('base', amountAtLeast(500), 10, 'standard'),
      makeRule('partial', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'between', value: { min: 300, max: 800 } }] }, 20, 'special'),
      makeRule('conflict', amountAtLeast(700), 20, 'different'),
      makeRule('hidden', amountAtLeast(750), 5, 'hidden'),
      makeRule('impossible', amountAtLeast(1001), 50, 'out of range'),
      makeRule('no-overlap', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'lt', value: 250 }] }, 1, 'separate'),
    ];
    const analysis = analyzeRules(project(rules));
    expect(analysis.overlaps.some((overlap) => overlap.ruleAId === 'partial' && overlap.ruleBId === 'conflict' && overlap.conflict)).toBe(true);
    expect(analysis.overlaps.some((overlap) => overlap.ruleAId === 'base' && overlap.ruleBId === 'no-overlap')).toBe(false);
    expect(analysis.unreachableRuleIds).toContain('impossible');
    expect(analysis.shadowedRuleIds).toContain('hidden');
    expect(analysis.uncoveredExamples.length).toBeGreaterThan(0);
    expect(analysis.checkedCases).toBeGreaterThan(0);
  });

  it('evaluates OR groups and validates missing sample inputs precisely', () => {
    const rule = makeRule('either', { kind: 'group', operator: 'or', conditions: [
      { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' },
      { kind: 'predicate', fieldId: 'active', operator: 'isTrue', value: true },
    ] });
    const result = evaluateSample(project([rule]), { amount: 10, tier: 'basic', active: true });
    expect(result.valid).toBe(true);
    expect(result.winner?.id).toBe('either');
    const missing = evaluateSample(project([rule]), { amount: 10, tier: 'gold' });
    expect(missing.errors).toEqual(['请填写“启用”']);
  });
});

describe('field impact analysis', () => {
  it('keeps every affected condition in the report instead of compressing references', () => {
    const rules = Array.from({ length: 42 }, (_, index) => makeRule(
      `rule-${index}`,
      { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' }] },
    ));
    const source = project(rules);
    const report = planFieldChange(source, {
      kind: 'update',
      fieldId: 'tier',
      next: { ...tier, enumValues: ['basic', 'platinum'] },
    });
    expect(report?.entries).toHaveLength(42);
    expect(report?.affectedRuleCount).toBe(42);
    expect(report?.entries.every((entry) => entry.severity === 'invalid' && entry.reasonCode === 'enum-option-removed')).toBe(true);
  });

  it('classifies range narrowing, added enum options, renames, and deletion separately', () => {
    const rules = [
      makeRule('outside', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'gte', value: 900 }] }),
      makeRule('partial', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'gte', value: 300 }] }),
      makeRule('not-eq', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'notEq', value: 'basic' }] }),
      makeRule('eq-gold', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' }] }),
      makeRule('renamed', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'active', operator: 'isTrue', value: true }] }),
    ];
    const source = project(rules);
    const rangeReport = planFieldChange(source, { kind: 'update', fieldId: 'amount', next: { ...amount, min: 0, max: 500 } });
    expect(rangeReport?.entries.find((entry) => entry.ruleId === 'outside')?.severity).toBe('invalid');
    expect(rangeReport?.entries.find((entry) => entry.ruleId === 'partial')?.severity).toBe('review');

    const enumReport = planFieldChange(source, { kind: 'update', fieldId: 'tier', next: { ...tier, enumValues: ['basic', 'gold', 'platinum'] } });
    expect(enumReport?.entries[0]).toMatchObject({ ruleId: 'not-eq', severity: 'review', reasonCode: 'enum-option-added' });

    const renameReport = planFieldChange(source, { kind: 'update', fieldId: 'active', next: { ...active, name: '是否启用' } });
    expect(renameReport?.entries[0]).toMatchObject({ ruleId: 'renamed', severity: 'review', reasonCode: 'field-renamed' });

    const deleteReport = planFieldChange(source, { kind: 'delete', fieldId: 'tier' });
    expect(deleteReport?.totalConditions).toBe(2);
    expect(deleteReport?.entries.every((entry) => entry.reasonCode === 'field-deleted')).toBe(true);
  });

  it('removes an entry only after its condition is individually confirmed', () => {
    const source = project([
      makeRule('one', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' }] }),
      makeRule('two', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' }] }),
    ]);
    const nextTier = { ...tier, enumValues: ['basic'] };
    const review = createFieldImpactReview(planFieldChange(source, {
      kind: 'update',
      fieldId: 'tier',
      next: nextTier,
    })!);
    const changedSource = { ...source, fields: source.fields.map((field) => field.id === 'tier' ? nextTier : field) };
    const withReview = { ...changedSource, fieldImpactReviews: [review] };
    const afterFirst = confirmImpactEntry(withReview, review.entries[0].id);
    expect(afterFirst.fieldImpactReviews[0].entries).toHaveLength(1);
    expect(afterFirst.fieldImpactReviews[0].entries[0].id).toBe(review.entries[1].id);
    const afterSecond = confirmImpactEntry(afterFirst, review.entries[1].id);
    expect(afterSecond.fieldImpactReviews).toEqual([]);
  });
});
