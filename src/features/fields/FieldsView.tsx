import { useEffect, useMemo, useState } from 'react';
import type { FieldImpactReport, FieldType, RuleField } from '../../models/ruleModel';
import type { WorkspaceState } from '../../viewmodels/workspaceViewModel';
import type { FieldsViewModel } from './fieldsViewModel';
import type { ImpactViewModel } from '../impact/ImpactViewModel';
import { ImpactDialog } from '../impact/ImpactDialog';
import { ImpactQueue } from '../impact/ImpactQueue';

interface FieldsViewProps {
  state: WorkspaceState;
  viewModel: FieldsViewModel;
  impactViewModel: ImpactViewModel;
}

const fieldTypes: { type: FieldType; label: string; icon: string }[] = [
  { type: 'number', label: '数值', icon: '↕' },
  { type: 'enum', label: '枚举', icon: '☷' },
  { type: 'boolean', label: '布尔', icon: '◉' },
];

export function FieldsView({ state, viewModel, impactViewModel }: FieldsViewProps) {
  const fields = state.project?.fields ?? [];
  const reviews = impactViewModel.reviews();
  const [draftMap, setDraftMap] = useState<Record<string, RuleField>>({});
  const [report, setReport] = useState<FieldImpactReport | null>(null);

  const fieldDrafts = useMemo(() => Object.fromEntries(fields.map((field) => [field.id, draftMap[field.id] ?? field])), [draftMap, fields]);

  useEffect(() => {
    setDraftMap({});
    setReport(null);
  }, [state.project?.id]);

  const updateDraft = (fieldId: string, updates: Partial<RuleField>) => {
    const field = fields.find((candidate) => candidate.id === fieldId);
    if (!field) return;
    setDraftMap((current) => ({ ...current, [fieldId]: { ...(current[fieldId] ?? field), ...updates } }));
  };

  const resetDraft = (fieldId: string) => {
    setDraftMap((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  };

  const previewUpdate = (field: RuleField) => {
    const nextField = fieldDrafts[field.id];
    setReport(viewModel.previewFieldChange(field.id, { nextField }));
  };

  const previewDelete = (field: RuleField) => {
    setReport(viewModel.previewFieldChange(field.id, { delete: true }));
  };

  const confirmReport = () => {
    if (!report) return;
    const field = fields.find((candidate) => candidate.id === report.fieldId);
    if (field && report.action === 'update') viewModel.applyFieldChange(field.id, { nextField: fieldDrafts[field.id] });
    if (report.action === 'delete') viewModel.removeField(report.fieldId);
    setReport(null);
    if (field) resetDraft(field.id);
  };

  return (
    <section className="module-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">模块 01 / 输入空间</span>
          <h1>字段定义</h1>
          <p>改动名称、范围或选项前先看完整影响清单；保存后逐条确认受影响条件。</p>
        </div>
        <span className="count-chip">{fields.length} 个字段</span>
      </div>

      <div className="field-toolbar card-surface">
        <div><strong>添加输入字段</strong><span>字段类型创建后固定，合法范围可以随时调整。</span></div>
        <div className="button-row">
          {fieldTypes.map(({ type, label, icon }) => <button className="button button-subtle" key={type} onClick={() => viewModel.addField(type)}><span className="button-icon">{icon}</span>{label}</button>)}
        </div>
      </div>

      {fields.length === 0 ? (
        <div className="empty-card card-surface">
          <div className="empty-icon">＋</div><h2>从第一个字段开始</h2>
          <p>数值字段适合金额或分数，枚举字段适合等级，布尔字段表示是或否。</p>
        </div>
      ) : (
        <div className="field-grid">
          {fields.map((field, index) => <FieldCard key={field.id} field={field} draft={fieldDrafts[field.id]} index={index} referenced={viewModel.isReferenced(field.id)} activeImpactCount={reviews.find((review) => review.fieldId === field.id)?.conditions.length ?? 0} onUpdate={(updates) => updateDraft(field.id, updates)} onPreviewSave={() => previewUpdate(field)} onReset={() => resetDraft(field.id)} onRemove={() => previewDelete(field)} />)}
        </div>
      )}

      <ImpactQueue reviews={reviews} fields={fields} impact={impactViewModel} />
      {state.validationIssues.filter((issue) => issue.fieldId).map((issue) => <div className="inline-issue" key={`${issue.code}-${issue.fieldId}`}>! {issue.message}</div>)}
      {report && <ImpactDialog report={report} onCancel={() => setReport(null)} onConfirm={confirmReport} />}
    </section>
  );
}

interface FieldCardProps {
  field: RuleField;
  draft: RuleField;
  index: number;
  referenced: boolean;
  activeImpactCount: number;
  onUpdate: (updates: Partial<RuleField>) => void;
  onPreviewSave: () => void;
  onReset: () => void;
  onRemove: () => void;
}

function FieldCard({ field, draft, index, referenced, activeImpactCount, onUpdate, onPreviewSave, onReset, onRemove }: FieldCardProps) {
  const changed = JSON.stringify(normalizeField(field)) !== JSON.stringify(normalizeField(draft));
  return (
    <article className={`field-card card-surface${activeImpactCount ? ' field-card-impact' : ''}`}>
      <header className="card-heading">
        <div className="field-index">{String(index + 1).padStart(2, '0')}</div>
        <div className="field-heading-copy"><span className="type-tag">{field.type === 'number' ? 'NUMBER' : field.type === 'enum' ? 'ENUM' : 'BOOLEAN'}</span><strong>{draft.name || '未命名字段'}</strong></div>
        <button className="icon-button danger-hover" aria-label={`删除${field.name}`} title="删除字段并查看影响" onClick={onRemove}>×</button>
      </header>
      <label className="input-label">字段名称<input value={draft.name} onChange={(event) => onUpdate({ name: event.target.value })} placeholder="例如：订单金额" /></label>
      {field.type === 'number' && <div className="range-fields">
        <label className="input-label">最小值<input type="number" value={draft.min ?? ''} onChange={(event) => onUpdate({ min: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
        <span className="range-dash">—</span>
        <label className="input-label">最大值<input type="number" value={draft.max ?? ''} onChange={(event) => onUpdate({ max: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
      </div>}
      {field.type === 'enum' && <label className="input-label">可选值 <span className="muted-note">以逗号分隔</span><textarea rows={3} value={(draft.enumValues ?? []).join(', ')} onChange={(event) => onUpdate({ enumValues: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="普通会员, 银卡会员, 金卡会员" /></label>}
      {field.type === 'boolean' && <div className="boolean-definition"><span className="toggle-preview">是 / 否</span><span>输入值只能为真或假</span></div>}
      <footer className="field-card-footer">
        <span className={referenced ? 'reference-state is-used' : 'reference-state'}><i />{activeImpactCount ? `${activeImpactCount} 个条件待确认` : referenced ? '已被规则引用' : '尚未被引用'}</span>
        <span className="field-card-actions">{changed && <button className="text-button" onClick={onReset}>撤销草稿</button>}<button className="text-button" disabled={!changed} onClick={onPreviewSave}>检查影响并保存</button></span>
      </footer>
    </article>
  );
}

function normalizeField(field: RuleField): Record<string, unknown> {
  const normalized: Record<string, unknown> = { id: field.id, name: field.name.trim(), type: field.type };
  if (field.type === 'number') {
    if (typeof field.min === 'number' && Number.isFinite(field.min)) normalized.min = field.min;
    if (typeof field.max === 'number' && Number.isFinite(field.max)) normalized.max = field.max;
  }
  if (field.type === 'enum') normalized.enumValues = field.enumValues ?? [];
  return normalized;
}
