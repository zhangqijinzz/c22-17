import { describe, expect, it } from 'vitest';
import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { RulesViewModel } from '../features/rules/rulesViewModel';
import { ImpactReviewViewModel } from '../features/impact/ImpactReviewViewModel';
import { SamplesViewModel } from '../features/samples/samplesViewModel';
import { RuleWorkspaceViewModel } from '../viewmodels/workspaceViewModel';

class MemoryRepository {
  async load() { return null; }
  async save() { return undefined; }
}

class FakeChecker {
  run() { return { promise: Promise.resolve({ checkedCases: 1, coveredCases: 1, coveragePercent: 100, overlaps: [], unreachableRuleIds: [], shadowedRuleIds: [], uncoveredExamples: [], truncated: false }), cancel() {} }; }
}

describe('feature ViewModels', () => {
  it('adds typed fields, builds a rule, reports deletion impact, and confirms each affected condition', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    const rules = new RulesViewModel(workspace);
    const impacts = new ImpactReviewViewModel(workspace);
    const samples = new SamplesViewModel(workspace);
    fields.addField('boolean');
    rules.addRule();
    const addedField = workspace.getSnapshot().project?.fields.at(-1);
    expect(addedField?.type).toBe('boolean');
    const preview = fields.previewFieldDelete('member-level');
    expect(preview?.entries.length).toBeGreaterThan(0);
    expect(fields.removeField('member-level')).toBe(true);
    expect(workspace.getSnapshot().project?.fieldImpactReviews[0].entries.length).toBe(preview?.entries.length);
    expect(impacts.entries()).toHaveLength(preview?.entries.length ?? 0);
    const first = impacts.entries()[0];
    impacts.confirm(first.id);
    expect(impacts.entries()).toHaveLength((preview?.entries.length ?? 1) - 1);
    const project = workspace.getSnapshot().project;
    expect(project).toBeDefined();
    const boolField = project?.fields.at(-1);
    if (boolField) samples.setValue(boolField.id, true);
    samples.evaluate();
    expect(workspace.getSnapshot().sampleEvaluation?.valid).toBe(true);
    workspace.dispose();
  });
});
