import { useState } from 'react';
import type { FieldType, RuleField } from '../../models/ruleModel';
import type { WorkspaceState } from '../../viewmodels/workspaceViewModel';
import type { FieldsViewModel } from './fieldsViewModel';
import { FieldChangeDialog } from './FieldChangeDialog';
import type { ImpactReviewViewModel } from '../impact/ImpactReviewViewModel';
import { ImpactReviewCenter } from '../impact/ImpactReviewCenter';

interface FieldsViewProps {
  state: WorkspaceState;
  viewModel: FieldsViewModel;
  impactViewModel: ImpactReviewViewModel;
}

const fieldTypes: { type: FieldType; label: string; icon: string }[] = [
  { type: 'number', label: '数值', icon: '↕' },
  { type: 'enum', label: '枚举', icon: '☷' },
  { type: 'boolean', label: '布尔', icon: '◉' },
];

export function FieldsView({ state, viewModel, impactViewModel }: FieldsViewProps) {
  const fields = state.project?.fields ?? [];
  const pendingImpacts = impactViewModel.entries();
  const [dialog, setDialog] = useState<{ field: RuleField; mode: 'edit' | 'delete' } | null>(null);
  return (
    <section className="module-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">模块 01 / 输入空间</span>
          <h1>字段定义</h1>
          <p>先计算影响清单，再决定是否调整名称、范围、选项或删除字段。</p>
        </div>
        <span className="count-chip">{fields.length} 个字段{pendingImpacts.length ? ` · ${pendingImpacts.length} 个条件待确认` : ''}</span>
      </div>

      <div className="field-toolbar card-surface">
        <div><strong>添加输入字段</strong><span>字段类型创建后固定；改动已有字段会先列出每个条件。</span></div>
        <div className="button-row">
          {fieldTypes.map(({ type, label, icon }) => <button className="button button-subtle" key={type} onClick={() => viewModel.addField(type)}><span className="button-icon">{icon}</span>{label}</button>)}
        </div>
      </div>

      {pendingImpacts.length > 0 && <ImpactReviewCenter entries={pendingImpacts} onConfirm={(entryId) => impactViewModel.confirm(entryId)} embedded />}

      {fields.length === 0 ? (
        <div className="empty-card card-surface">
          <div className="empty-icon">＋</div><h2>从第一个字段开始</h2>
          <p>数值字段适合金额或分数，枚举字段适合等级，布尔字段表示是或否。</p>
        </div>
      ) : (
        <div className="field-grid">
          {fields.map((field, index) => <FieldCard key={field.id} field={field} index={index} referenced={viewModel.isReferenced(field.id)} pendingCount={pendingImpacts.filter((entry) => entry.fieldId === field.id).length} onEdit={() => setDialog({ field, mode: 'edit' })} onRemove={() => setDialog({ field, mode: 'delete' })} />)}
        </div>
      )}

      {state.validationIssues.filter((issue) => issue.fieldId).map((issue) => <div className="inline-issue" key={`${issue.code}-${issue.fieldId}`}>! {issue.message}</div>)}
      {dialog && <FieldChangeDialog field={dialog.field} mode={dialog.mode} viewModel={viewModel} onClose={() => setDialog(null)} />}
    </section>
  );
}

interface FieldCardProps {
  field: RuleField;
  index: number;
  referenced: boolean;
  pendingCount: number;
  onEdit: () => void;
  onRemove: () => void;
}

function FieldCard({ field, index, referenced, pendingCount, onEdit, onRemove }: FieldCardProps) {
  return (
    <article className={`field-card card-surface${pendingCount ? ' field-card-pending' : ''}`}>
      <header className="card-heading">
        <div className="field-index">{String(index + 1).padStart(2, '0')}</div>
        <div className="field-heading-copy"><span className="type-tag">{field.type === 'number' ? 'NUMBER' : field.type === 'enum' ? 'ENUM' : 'BOOLEAN'}</span><strong>{field.name || '未命名字段'}</strong></div>
        <button className="text-button" onClick={onEdit}>影响预览 / 编辑</button>
        <button className="icon-button danger-hover" aria-label={`删除${field.name}`} title="删除字段并查看影响" onClick={onRemove}>×</button>
      </header>
      <div className="field-definition-preview">
        {field.type === 'number' && <span>{field.min ?? '-'} — {field.max ?? '-'}</span>}
        {field.type === 'enum' && <span>{(field.enumValues ?? []).join(' · ')}</span>}
        {field.type === 'boolean' && <span>是 / 否</span>}
      </div>
      <footer className="field-card-footer"><span className={referenced ? 'reference-state is-used' : 'reference-state'}><i />{referenced ? '已被规则引用' : '尚未被引用'}</span><span>{pendingCount ? `${pendingCount} 个条件待确认` : field.type === 'number' ? '闭区间范围' : field.type === 'enum' ? `${field.enumValues?.length ?? 0} 个选项` : '二元输入'}</span></footer>
    </article>
  );
}
