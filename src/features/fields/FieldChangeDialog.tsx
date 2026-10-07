import { useMemo, useState } from 'react';
import { validateField } from '../../domain/fieldValidation';
import type { RuleField } from '../../models/ruleModel';
import { ImpactReviewCenter } from '../impact/ImpactReviewCenter';
import type { FieldsViewModel } from './fieldsViewModel';

interface FieldChangeDialogProps {
  field: RuleField;
  mode: 'edit' | 'delete';
  viewModel: FieldsViewModel;
  onClose: () => void;
}

export function FieldChangeDialog({ field, mode, viewModel, onClose }: FieldChangeDialogProps) {
  const [draft, setDraft] = useState<RuleField>(structuredClone(field));
  const deleteReport = useMemo(() => mode === 'delete' ? viewModel.previewFieldDelete(field.id) : null, [field.id, mode, viewModel]);
  const editReport = useMemo(() => mode === 'edit' ? viewModel.previewFieldChange(field.id, draft) : null, [draft, field.id, mode, viewModel]);
  const report = deleteReport ?? editReport;
  const fieldIssues = mode === 'edit' ? validateField(draft) : [];

  const apply = () => {
    if (!report) return;
    const applied = mode === 'delete' ? viewModel.applyFieldDelete(field.id) : viewModel.applyFieldChange(field.id, draft);
    if (applied) onClose();
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="field-change-dialog card-surface" role="dialog" aria-modal="true" aria-labelledby="field-change-title">
        <header className="dialog-heading">
          <div><span className="eyebrow">FIELD IMPACT</span><h2 id="field-change-title">{mode === 'delete' ? '删除字段前的影响清单' : '调整字段前的影响清单'}</h2></div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
        </header>

        {mode === 'edit' ? (
          <div className="dialog-draft-grid">
            <label className="input-label">字段名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            {draft.type === 'number' && <div className="range-fields">
              <label className="input-label">最小值<input type="number" value={draft.min ?? ''} onChange={(event) => setDraft({ ...draft, min: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
              <span className="range-dash">—</span>
              <label className="input-label">最大值<input type="number" value={draft.max ?? ''} onChange={(event) => setDraft({ ...draft, max: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
            </div>}
            {draft.type === 'enum' && <label className="input-label">可选值 <span className="muted-note">以逗号分隔</span><textarea rows={3} value={(draft.enumValues ?? []).join(', ')} onChange={(event) => setDraft({ ...draft, enumValues: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>}
          </div>
        ) : <p className="delete-confirmation">将删除字段“{field.name}”。引用它的条件不会被静默移除，而会保留并逐条标记。</p>}

        {fieldIssues.map((issue) => <div className="inline-issue" key={issue.code}>! {issue.message}</div>)}

        {report && <div className="impact-report-summary">
          <div><strong>{report.entries.length}</strong><span>受影响条件</span></div>
          <div><strong>{report.affectedRuleCount}</strong><span>涉及规则</span></div>
          <div className="impact-invalid"><strong>{report.invalidCount}</strong><span>已失效</span></div>
          <div><strong>{report.reviewCount}</strong><span>需复核</span></div>
        </div>}

        <div className="impact-changes">{(report?.changeSummary ?? []).map((change) => <span key={change}>{change}</span>)}</div>
        {report && report.entries.length > 0 && <div className="dialog-impact-list"><ImpactReviewCenter entries={report.entries} onConfirm={() => undefined} embedded readOnly /></div>}
        {report && report.entries.length === 0 && <div className="impact-empty">当前改动没有条件引用或不会改变条件语义，可以直接{mode === 'delete' ? '删除' : '应用'}。</div>}

        <footer className="dialog-actions">
          <button className="button button-subtle" onClick={onClose}>再看看</button>
          <button className={`button ${mode === 'delete' ? 'button-quiet' : 'button-primary'}`} disabled={fieldIssues.length > 0 || !report} onClick={apply}>{mode === 'delete' ? `查看清单并删除（${report?.entries.length ?? 0}）` : `查看清单并应用（${report?.entries.length ?? 0}）`}</button>
        </footer>
      </section>
    </div>
  );
}
