import { defaultSample } from '../../domain/conditionEvaluator';
import { createFieldImpactReview, planFieldChange, type FieldImpactReport } from '../../domain/fieldImpact';
import type { FieldType, RuleField } from '../../models/ruleModel';
import type { WorkspacePort } from '../../viewmodels/workspacePort';

export class FieldsViewModel {
  constructor(private readonly workspace: WorkspacePort) {}

  addField(type: FieldType): void {
    const project = this.workspace.getSnapshot().project;
    if (!project) return;
    const ordinal = project.fields.length + 1;
    const field: RuleField = type === 'number'
      ? { id: makeId('field'), name: `数值字段 ${ordinal}`, type, min: 0, max: 1000 }
      : type === 'enum'
        ? { id: makeId('field'), name: `枚举字段 ${ordinal}`, type, enumValues: ['选项 A', '选项 B'] }
        : { id: makeId('field'), name: `布尔字段 ${ordinal}`, type };
    this.workspace.commitProject({
      ...project,
      fields: [...project.fields, field],
      sampleInputs: { ...defaultSample(project.fields), ...project.sampleInputs, ...defaultSample([field]) },
    }, `已添加字段“${field.name}”`);
  }

  previewFieldChange(fieldId: string, next: RuleField): FieldImpactReport | null {
    const project = this.workspace.getSnapshot().project;
    return project ? planFieldChange(project, { kind: 'update', fieldId, next }) : null;
  }

  previewFieldDelete(fieldId: string): FieldImpactReport | null {
    const project = this.workspace.getSnapshot().project;
    return project ? planFieldChange(project, { kind: 'delete', fieldId }) : null;
  }

  applyFieldChange(fieldId: string, next: RuleField): boolean {
    const project = this.workspace.getSnapshot().project;
    if (!project) return false;
    const report = this.previewFieldChange(fieldId, next);
    if (!report) return false;
    const review = report.entries.length ? createFieldImpactReview(report) : undefined;
    const committed = this.workspace.commitProject({
      ...project,
      fields: project.fields.map((field) => field.id === fieldId ? structuredClone(next) : field),
      fieldImpactReviews: review ? [review, ...project.fieldImpactReviews] : project.fieldImpactReviews,
    }, this.changeNotice(report));
    return committed;
  }

  updateField(fieldId: string, updates: Partial<RuleField>): boolean {
    const project = this.workspace.getSnapshot().project;
    const field = project?.fields.find((candidate) => candidate.id === fieldId);
    if (!project || !field) return false;
    return this.applyFieldChange(fieldId, { ...field, ...updates });
  }

  applyFieldDelete(fieldId: string): boolean {
    const project = this.workspace.getSnapshot().project;
    if (!project) return false;
    const report = this.previewFieldDelete(fieldId);
    if (!report) return false;
    const review = createFieldImpactReview(report);
    const sampleInputs = { ...project.sampleInputs };
    delete sampleInputs[fieldId];
    const committed = this.workspace.commitProject({
      ...project,
      fields: project.fields.filter((field) => field.id !== fieldId),
      sampleInputs,
      fieldImpactReviews: [review, ...project.fieldImpactReviews],
    }, this.changeNotice(report));
    if (committed && report.entries.length) this.workspace.navigate('rules');
    return committed;
  }

  removeField(fieldId: string): boolean {
    return this.applyFieldDelete(fieldId);
  }

  isReferenced(fieldId: string): boolean {
    const project = this.workspace.getSnapshot().project;
    return project?.rules.some((rule) => referencesField(rule.conditions, fieldId)) ?? false;
  }

  private changeNotice(report: FieldImpactReport): string {
    if (!report.entries.length) return report.kind === 'delete' ? '字段已删除，没有规则引用该字段' : '字段已更新，没有条件需要重新确认';
    const action = report.kind === 'delete' ? '删除' : '调整';
    return `已${action}字段，${report.affectedRuleCount} 条规则、${report.entries.length} 个条件需要逐条确认`;
  }
}

function referencesField(condition: import('../../models/ruleModel').RuleCondition, fieldId: string): boolean {
  return condition.kind === 'group'
    ? condition.conditions.some((child) => referencesField(child, fieldId))
    : condition.fieldId === fieldId;
}

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
