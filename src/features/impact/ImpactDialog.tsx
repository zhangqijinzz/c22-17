import { useMemo, useState } from 'react';
import type { FieldImpactReport, ImpactedCondition } from '../../models/ruleModel';

interface ImpactDialogProps {
  report: FieldImpactReport;
  onCancel: () => void;
  onConfirm: () => void;
}

const severityLabels = {
  info: '引用确认',
  warning: '可能失效',
  invalid: '必须处理',
} as const;

const stateLabels: Record<ImpactedCondition['state'], string> = {
  'reference-only': '引用确认',
  'scope-changed': '范围变化',
  'always-true': '变为恒成立',
  impossible: '变为恒不成立',
  'scope-partial': '部分越界',
  'invalid-value': '选项或值失效',
  'field-deleted': '字段已删除',
};

const PAGE_SIZE = 8;

export function ImpactDialog({ report, onCancel, onConfirm }: ImpactDialogProps) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<'all' | 'info' | 'warning' | 'invalid'>('all');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return report.conditions.filter((condition) => {
      if (severity !== 'all' && condition.severity !== severity) return false;
      if (!keyword) return true;
      return [condition.ruleName, condition.fieldName, condition.reason, condition.valueText]
        .some((value) => value.toLowerCase().includes(keyword));
    });
  }, [query, report.conditions, severity]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleConditions = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const grouped = new Map(visibleConditions.map((condition) => [condition.ruleId, { id: condition.ruleId, name: condition.ruleName, conditions: [] as ImpactedCondition[] }]));
  visibleConditions.forEach((condition) => grouped.get(condition.ruleId)?.conditions.push(condition));
  const destructive = report.action === 'delete' || report.counts.invalid > 0;

  return (
    <div className="impact-dialog-backdrop" role="presentation">
      <section className="impact-dialog card-surface" role="dialog" aria-modal="true" aria-labelledby="impact-dialog-title">
        <header className="impact-dialog-header">
          <div>
            <span className="eyebrow">FIELD IMPACT ANALYSIS</span>
            <h2 id="impact-dialog-title">{report.action === 'delete' ? '删除字段前的影响清单' : '字段变更影响清单'}</h2>
            <p>目标字段：{report.fieldName}</p>
          </div>
          <button className="icon-button" aria-label="关闭影响清单" onClick={onCancel}>×</button>
        </header>

        <div className="impact-summary-strip">
          <span><b>{report.counts.rules}</b> 条规则</span>
          <span><b>{report.counts.conditions}</b> 个条件</span>
          <span className="impact-invalid"><b>{report.counts.invalid}</b> 必须处理</span>
          <span className="impact-warning"><b>{report.counts.warning}</b> 可能失效</span>
        </div>

        <div className="impact-change-list">
          {report.changes.map((change) => <div className="impact-change-row" key={change.key}><span>{change.label}</span><b>{change.before}</b><i>→</i><strong>{change.after}</strong></div>)}
        </div>

        <div className="impact-filter-bar">
          <input aria-label="搜索影响清单" placeholder="搜索规则、条件或原因" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
          <select aria-label="按影响程度过滤" value={severity} onChange={(event) => { setSeverity(event.target.value as typeof severity); setPage(1); }}>
            <option value="all">全部 {report.counts.conditions}</option>
            <option value="invalid">必须处理 {report.counts.invalid}</option>
            <option value="warning">可能失效 {report.counts.warning}</option>
            <option value="info">引用确认 {report.counts.info}</option>
          </select>
        </div>

        <div className="impact-dialog-list">
          {filtered.length === 0 && <div className="impact-empty">当前筛选条件下没有受影响条件。</div>}
          {[...grouped.values()].map((group) => <section className="impact-rule-group" key={group.id}>
            <h3>{group.name}<span>{group.conditions.length} 个条件</span></h3>
            {group.conditions.map((condition) => <article className={`impact-entry impact-${condition.severity}`} key={`${condition.ruleId}-${condition.path.join('.')}`}>
              <div><strong>{formatOperator(condition)}</strong><small>{condition.reason}</small></div>
              <span>{severityLabels[condition.severity]} · {stateLabels[condition.state]}</span>
            </article>)}
          </section>)}
        </div>

        <footer className="impact-dialog-footer">
          <span>{filtered.length === report.conditions.length ? `完整列出 ${filtered.length} / ${report.conditions.length} 个条件，未做“仍被引用”式折叠。` : `筛选显示 ${filtered.length} / ${report.conditions.length} 个条件`}</span>
          <div className="button-row">
            <button className="button button-subtle" onClick={onCancel}>先不改</button>
            <button className={`button ${destructive ? 'button-danger' : 'button-primary'}`} onClick={onConfirm}>
              {report.action === 'delete' ? `仍要删除并标出 ${report.counts.conditions} 个条件` : '应用变更并逐条确认'}
            </button>
          </div>
        </footer>
        {filtered.length > PAGE_SIZE && <div className="impact-pagination">
          <button className="text-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <span>第 {currentPage} / {pageCount} 页</span>
          <button className="text-button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </div>}
      </section>
    </div>
  );
}

function formatOperator(condition: ImpactedCondition): string {
  return `${condition.fieldName} ${operatorLabel(condition.operator)} ${condition.valueText}`;
}

function operatorLabel(operator: ImpactedCondition['operator']): string {
  const labels: Record<ImpactedCondition['operator'], string> = {
    eq: '等于',
    notEq: '不等于',
    gt: '大于',
    gte: '大于等于',
    lt: '小于',
    lte: '小于等于',
    between: '介于',
    isTrue: '为真',
    isFalse: '为假',
  };
  return labels[operator];
}
