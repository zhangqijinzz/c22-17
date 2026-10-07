import { describe, expect, it } from 'vitest';
import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { ImpactViewModel } from '../features/impact/ImpactViewModel';
import { reviewConditionKey } from '../domain/fieldImpact';
import { RuleWorkspaceViewModel } from '../viewmodels/workspaceViewModel';

class MemoryRepository {
  async load() { return null; }
  async save() { return undefined; }
}

class FakeChecker {
  run() {
    return {
      promise: Promise.resolve({ checkedCases: 1, coveredCases: 1, coveragePercent: 100, overlaps: [], unreachableRuleIds: [], shadowedRuleIds: [], uncoveredExamples: [], truncated: false }),
      cancel() {},
    };
  }
}

describe('post-change impact review', () => {
  it('keeps every deleted-field condition, acknowledges items individually, and resolves them by removal', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    const impact = new ImpactViewModel(workspace);

    fields.removeField('member-level');
    let review = impact.reviews()[0];
    expect(review.conditions).toHaveLength(2);
    const first = review.conditions[0];
    impact.acknowledge(review.id, reviewConditionKey(first));
    review = impact.reviews()[0];
    expect(review.acknowledgedConditionKeys).toHaveLength(1);
    expect(impact.blockingConditions(review)).toHaveLength(2);

    impact.archiveReview(review.id);
    expect(impact.reviews()).toHaveLength(1);
    expect(workspace.getSnapshot().notice).toContain('还有 2 个条件');

    const firstStill = impact.reviews()[0].conditions.find((condition) => condition.ruleId === first.ruleId && condition.path.join('.') === first.path.join('.'));
    expect(firstStill).toBeDefined();
    impact.removeCondition(first.ruleId, first.path);
    expect(impact.reviews()[0].conditions).toHaveLength(1);
    workspace.dispose();
  });

  it('can repair a missing-field predicate by choosing another field directly from the review', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    const impact = new ImpactViewModel(workspace);

    fields.removeField('member-level');
    const entry = impact.reviews()[0].conditions[0];
    impact.replaceCondition(entry.ruleId, entry.path, { kind: 'predicate', fieldId: 'coupon-active', operator: 'isTrue', value: true });
    expect(impact.reviews()[0].conditions).toHaveLength(1);
    expect(workspace.getSnapshot().project?.rules.find((rule) => rule.id === entry.ruleId)?.conditions.conditions.some((condition) => condition.kind === 'predicate' && condition.fieldId === 'coupon-active')).toBe(true);
    workspace.dispose();
  });
});
