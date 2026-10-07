import { reviewConditionKey } from '../../domain/fieldImpact';
import type {
  ConditionGroup,
  FieldImpactReview,
  ImpactedCondition,
  PredicateCondition,
  RuleCondition,
  RuleProject,
} from '../../models/ruleModel';
import type { WorkspacePort } from '../../viewmodels/workspacePort';

export class ImpactViewModel {
  constructor(private readonly workspace: WorkspacePort) {}

  reviews(): FieldImpactReview[] {
    return this.workspace.getSnapshot().project?.impactReviews ?? [];
  }

  findImpact(ruleId: string, path: number[]): { review: FieldImpactReview; condition: ImpactedCondition } | undefined {
    for (const review of this.reviews()) {
      const condition = review.conditions.find((candidate) => candidate.ruleId === ruleId && samePath(candidate.path, path));
      if (condition) return { review, condition };
    }
    return undefined;
  }

  isAcknowledged(reviewId: string, condition: ImpactedCondition): boolean {
    const review = this.reviews().find((candidate) => candidate.id === reviewId);
    return review?.acknowledgedConditionKeys.includes(reviewConditionKey(condition)) ?? false;
  }

  acknowledge(reviewId: string, conditionKey: string): void {
    this.updateReviews((review) => review.id === reviewId && !review.acknowledgedConditionKeys.includes(conditionKey)
      ? { ...review, acknowledgedConditionKeys: [...review.acknowledgedConditionKeys, conditionKey] }
      : review);
  }

  archiveReview(reviewId: string): void {
    const project = this.project();
    const review = project?.impactReviews?.find((candidate) => candidate.id === reviewId);
    if (!project || !review) return;
    const blocking = this.blockingConditions(review);
    if (blocking.length) {
      this.workspace.updateView({ notice: `还有 ${blocking.length} 个条件可能失效，请逐条确认或修复后再归档。` });
      return;
    }
    this.workspace.commitProject(
      { ...project, impactReviews: (project.impactReviews ?? []).filter((candidate) => candidate.id !== reviewId) },
      '已归档本次字段影响清单',
      { recheck: false },
    );
  }

  removeCondition(ruleId: string, path: number[]): void {
    const project = this.project();
    const rule = project?.rules.find((candidate) => candidate.id === ruleId);
    if (!project || !rule) return;
    const updatedRule = { ...rule, conditions: removeAtPath(rule.conditions, path) };
    this.workspace.commitProject(
      { ...project, rules: project.rules.map((candidate) => candidate.id === ruleId ? updatedRule : candidate) },
      '已移除受字段变更影响的条件',
    );
  }

  replaceCondition(ruleId: string, path: number[], nextCondition: PredicateCondition): void {
    const project = this.project();
    const rule = project?.rules.find((candidate) => candidate.id === ruleId);
    if (!project || !rule) return;
    const updatedRule = { ...rule, conditions: replaceAtPath(rule.conditions, path, nextCondition) };
    this.workspace.commitProject(
      { ...project, rules: project.rules.map((candidate) => candidate.id === ruleId ? updatedRule : candidate) },
      '已改选受字段变更影响的条件',
    );
  }

  openRule(ruleId: string): void {
    this.workspace.navigate('rules');
    this.workspace.selectRule(ruleId);
    requestAnimationFrame(() => {
      document.querySelector(`[data-rule-id="${ruleId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  blockingConditions(review: FieldImpactReview): ImpactedCondition[] {
    return review.conditions.filter((condition) =>
      condition.severity === 'invalid' || !review.acknowledgedConditionKeys.includes(reviewConditionKey(condition)),
    );
  }

  private updateReviews(update: (review: FieldImpactReview) => FieldImpactReview): void {
    const project = this.project();
    if (!project) return;
    this.workspace.commitProject(
      { ...project, impactReviews: (project.impactReviews ?? []).map(update) },
      '已确认一个条件',
      { recheck: false },
    );
  }

  private project(): RuleProject | null {
    return this.workspace.getSnapshot().project;
  }
}

function samePath(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function removeAtPath(group: RuleCondition, path: number[]): ConditionGroup {
  if (path.length === 0 || group.kind === 'predicate') return group as ConditionGroup;
  if (path.length === 1) return { ...group, conditions: group.conditions.filter((_, index) => index !== path[0]) };
  const [index, ...rest] = path;
  return { ...group, conditions: group.conditions.map((condition, conditionIndex) => conditionIndex === index ? removeAtPath(condition, rest) : condition) };
}

function replaceAtPath(group: RuleCondition, path: number[], nextCondition: PredicateCondition): ConditionGroup {
  if (path.length === 0 || group.kind === 'predicate') return group as ConditionGroup;
  if (path.length === 1) return { ...group, conditions: group.conditions.map((condition, index) => index === path[0] ? nextCondition : condition) };
  const [index, ...rest] = path;
  return { ...group, conditions: group.conditions.map((condition, conditionIndex) => conditionIndex === index ? replaceAtPath(condition, rest, nextCondition) : condition) };
}
