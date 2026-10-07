import { defaultSample } from '../../domain/conditionEvaluator';
import { createImpactReview, planFieldImpact } from '../../domain/fieldImpact';
import type { FieldImpactReport, FieldType, RuleField } from '../../models/ruleModel';
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

  previewFieldChange(fieldId: string, draft: { nextField?: RuleField; delete?: boolean }): FieldImpactReport | null {
    const project = this.workspace.getSnapshot().project;
    if (!project) return null;
    return planFieldImpact(project, fieldId, draft);
  }

  applyFieldChange(fieldId: string, draft: { nextField?: RuleField; delete?: boolean }): FieldImpactReport | null {
    const project = this.workspace.getSnapshot().project;
    if (!project) return null;
    const report = planFieldImpact(project, fieldId, draft);
    const currentReviews = project.impactReviews ?? [];
    const reviews = report.counts.conditions > 0
      ? [...currentReviews.filter((review) => review.fieldId !== fieldId), createImpactReview(report)]
      : currentReviews.filter((review) => review.fieldId !== fieldId);

    if (draft.delete) {
      const sampleInputs = { ...project.sampleInputs };
      delete sampleInputs[fieldId];
      const nextProject: typeof project = {
        ...project,
        fields: project.fields.filter((field) => field.id !== fieldId),
        sampleInputs,
        impactReviews: reviews,
      };
      this.workspace.commitProject(nextProject, this.changeNotice(report, true));
      return report;
    }

    const nextField = draft.nextField;
    if (!nextField) return null;
    this.workspace.commitProject({
      ...project,
      fields: project.fields.map((field) => field.id === fieldId ? nextField : field),
      impactReviews: reviews,
    }, this.changeNotice(report, false));
    return report;
  }

  removeField(fieldId: string): FieldImpactReport | null {
    return this.applyFieldChange(fieldId, { delete: true });
  }

  isReferenced(fieldId: string): boolean {
    const project = this.workspace.getSnapshot().project;
    return project?.rules.some((rule) => referencesField(rule.conditions, fieldId)) ?? false;
  }

  private changeNotice(report: FieldImpactReport, deleted: boolean): string {
    if (!report.counts.conditions) return deleted ? `已删除字段“${report.fieldName}”` : `字段“${report.fieldName}”已更新`;
    if (deleted) {
      return `已删除字段“${report.fieldName}”：${report.counts.conditions} 个条件已标出，请逐条改选字段或移除。`;
    }
    const attention = report.counts.invalid + report.counts.warning;
    return attention
      ? `字段“${report.fieldName}”已更新：${attention} 个条件可能失效，已在规则中逐条标出。`
      : `字段“${report.fieldName}”已更新：${report.counts.conditions} 个引用条件已标出，请确认展示口径。`;
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
