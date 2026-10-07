import { useMemo, useState } from 'react';
import { reviewConditionKey } from '../../domain/fieldImpact';
import { defaultConditionForField } from '../rules/rulesViewModel';
import type { FieldImpactReview, ImpactedCondition, RuleField } from '../../models/ruleModel';
import type { ImpactViewModel } from './ImpactViewModel';

interface ImpactQueueProps {
  reviews: FieldImpactReview[];
  fields: RuleField[];
  impact: ImpactViewModel;
}

const severityLabel = { info: '引用确认', warning: '可能失效', invalid: '必须处理' } as const;

export function ImpactQueue({ reviews, fields, impact }: ImpactQueueProps) {
  const [query, setQuery] = useState('');
  const filteredReviews = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return reviews;
    return reviews.map((review) => ({
      ...review,
      conditions: review.conditions.filter((condition) => [review.fieldName, condition.ruleName, condition.reason, condition.valueText].some((value) => value.toLowerCase().includes(keyword))),
    })).filter((review) => review.conditions.length);
  }, [query, reviews]);

  if (!reviews.length) return null;

  return (
    <section className="impact-queue card-surface">
      <header className="impact-queue-header">
        <div>
          <span className="eyebrow">POST-CHANGE REVIEW</span>
          <h2>字段改动后的条件确认</h2>
          <p>每一个受影响条件都保留在清单中；处理或确认后才会从待办移除。</p>
        </div>
        <input aria-label="筛选待确认条件" placeholder="筛选规则或原因" value={query} onChange={(event) => setQuery(event.target.value)} />
      </header>
      <div className="impact-review-list">
        {filteredReviews.map((review) => <ReviewCard key={review.id} review={review} fields={fields} impact={impact} />)}
      </div>
    </section>
  );
}

function ReviewCard({ review, fields, impact }: { review: FieldImpactReview; fields: RuleField[]; impact: ImpactViewModel }) {
  const blocking = impact.blockingConditions(review);
  const acknowledged = review.acknowledgedConditionKeys.length;
  return (
    <article className="impact-review-card">
      <header>
        <div><h3>{review.action === 'delete' ? `删除字段“${review.fieldName}”` : `调整字段“${review.fieldName}”`}</h3><span>{review.conditions.length} 个条件 · {blocking.length} 个待处理 · {acknowledged} 个已确认</span></div>
        <button className="button button-subtle" disabled={blocking.length > 0} onClick={() => impact.archiveReview(review.id)}>归档清单</button>
      </header>
      {review.changes.map((change) => <div className="impact-change-row compact" key={change.key}><span>{change.label}</span><b>{change.before}</b><i>→</i><strong>{change.after}</strong></div>)}
      <div className="impact-review-conditions">
        {review.conditions.map((condition) => <ConditionReview key={reviewConditionKey(condition)} review={review} condition={condition} fields={fields} impact={impact} />)}
      </div>
    </article>
  );
}

function ConditionReview({ review, condition, fields, impact }: { review: FieldImpactReview; condition: ImpactedCondition; fields: RuleField[]; impact: ImpactViewModel }) {
  const key = reviewConditionKey(condition);
  const acknowledged = review.acknowledgedConditionKeys.includes(key);
  const deletedField = condition.state === 'field-deleted';
  return (
    <article className={`impact-review-entry impact-${condition.severity}${acknowledged ? ' is-acknowledged' : ''}`}>
      <div className="impact-entry-copy">
        <strong>{condition.ruleName}</strong>
        <span>{formatCondition(condition)}</span>
        <small>{condition.reason}</small>
        {deletedField && fields.length > 0 && <select aria-label="改选字段" value="" onChange={(event) => {
          const field = fields.find((candidate) => candidate.id === event.target.value);
          if (field) impact.replaceCondition(condition.ruleId, condition.path, defaultConditionForField(field));
        }}><option value="">改选字段</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select>}
      </div>
      <div className="impact-entry-actions">
        <em>{severityLabel[condition.severity]}</em>
        <button className="text-button" onClick={() => impact.openRule(condition.ruleId)}>打开规则</button>
        {condition.severity === 'invalid' && <button className="text-button danger-text" onClick={() => impact.removeCondition(condition.ruleId, condition.path)}>移除条件</button>}
        {!acknowledged
          ? <button className="button button-subtle impact-confirm-button" onClick={() => impact.acknowledge(review.id, key)}>{condition.severity === 'info' ? '确认无影响' : '我已知晓并保留'}</button>
          : <span className="impact-acknowledged">已确认，等待修复或后续处理</span>}
      </div>
    </article>
  );
}

function formatCondition(condition: ImpactedCondition): string {
  const labels: Record<ImpactedCondition['operator'], string> = {
    eq: '等于', notEq: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', between: '介于', isTrue: '为真', isFalse: '为假',
  };
  return `${condition.fieldName} ${labels[condition.operator]} ${condition.valueText}`;
}
