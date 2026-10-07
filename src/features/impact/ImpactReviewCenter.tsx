import { useMemo, useState } from 'react';
import type { FieldImpactEntry, NumberRange, ScalarValue } from '../../models/ruleModel';

interface ImpactReviewCenterProps {
  entries: FieldImpactEntry[];
  onConfirm: (entryId: string) => void;
  embedded?: boolean;
  readOnly?: boolean;
}

const PAGE_SIZE = 8;

export function ImpactReviewCenter({ entries, onConfirm, embedded = false, readOnly = false }: ImpactReviewCenterProps) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<'all' | 'invalid' | 'review'>('all');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries
      .filter((entry) => severity === 'all' || entry.severity === severity)
      .filter((entry) => !keyword || [entry.ruleName, entry.fieldName, entry.reason, entry.operator].some((value) => value.toLowerCase().includes(keyword)))
      .sort((a, b) => impactRank(a) - impactRank(b) || a.ruleName.localeCompare(b.ruleName, 'zh-CN'));
  }, [entries, query, severity]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const invalidCount = entries.filter((entry) => entry.severity === 'invalid').length;

  const body = (
    <>
      <div className="impact-toolbar">
        <div className="impact-title-copy"><span className="eyebrow">IMPACT REVIEW</span><strong>受影响条件确认</strong><small>{entries.length} 个条件 · {invalidCount} 个已失效 · 逐条确认，不合并为“仍被引用”</small></div>
        <input aria-label="搜索受影响规则或原因" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索规则、字段、原因" />
        <select aria-label="筛选影响等级" value={severity} onChange={(event) => { setSeverity(event.target.value as typeof severity); setPage(1); }}>
          <option value="all">全部影响</option>
          <option value="invalid">仅已失效</option>
          <option value="review">仅需复核</option>
        </select>
      </div>
      <div className="impact-entry-list">
        {visible.map((entry) => <ImpactEntryRow key={entry.id} entry={entry} readOnly={readOnly} onConfirm={onConfirm} />)}
      </div>
      <footer className="impact-pagination">
        <span>显示 {(currentPage - 1) * PAGE_SIZE + 1}–{(currentPage - 1) * PAGE_SIZE + visible.length}，共 {filtered.length} 条</span>
        <div className="button-row"><button className="button button-subtle" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pageCount}</span><button className="button button-subtle" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
      </footer>
    </>
  );

  return embedded ? <div className="impact-review-card impact-embedded">{body}</div> : <section className="impact-review-card card-surface">{body}</section>;
}

function ImpactEntryRow({ entry, readOnly, onConfirm }: { entry: FieldImpactEntry; readOnly: boolean; onConfirm: (id: string) => void }) {
  return (
    <article className={`impact-entry impact-${entry.severity}`}>
      <div className="impact-entry-main">
        <div className="impact-entry-heading"><span className={`severity-tag ${entry.severity === 'invalid' ? 'severity-danger' : 'severity-warn'}`}>{entry.severity === 'invalid' ? '已失效' : '需复核'}</span><strong>{entry.ruleName}</strong><code>{entry.conditionPath.map((index) => `#${index + 1}`).join(' / ')}</code></div>
        <p>{describeCondition(entry.fieldName, entry.operator, entry.value)}</p>
        <div className="impact-change"><span>{entry.before}</span><b>→</b><span>{entry.after}</span></div>
        <small>{entry.reason}</small>
      </div>
      {!readOnly && <button className="button button-outline" onClick={() => onConfirm(entry.id)}>确认此条件</button>}
    </article>
  );
}

export function describeCondition(fieldName: string, operator: string, value: ScalarValue | NumberRange): string {
  const operatorLabel: Record<string, string> = {
    eq: '等于', notEq: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', between: '介于', isTrue: '为真', isFalse: '为假',
  };
  return `${fieldName} ${operatorLabel[operator] ?? operator} ${formatValue(value)}`;
}

function formatValue(value: ScalarValue | NumberRange): string {
  if (typeof value === 'object' && value !== null && 'min' in value && 'max' in value) return `${value.min} 至 ${value.max}`;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function impactRank(entry: FieldImpactEntry): number {
  return entry.severity === 'invalid' ? 0 : 1;
}
