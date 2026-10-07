export type FieldType = 'number' | 'enum' | 'boolean';
export type ScalarValue = string | number | boolean;
export type ModuleId = 'fields' | 'rules' | 'samples' | 'inspection';

export interface RuleField {
  id: string;
  name: string;
  type: FieldType;
  enumValues?: string[];
  min?: number;
  max?: number;
}

export interface NumberRange {
  min: number;
  max: number;
}

export type PredicateCondition =
  | { kind: 'predicate'; fieldId: string; operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { kind: 'predicate'; fieldId: string; operator: 'between'; value: NumberRange }
  | { kind: 'predicate'; fieldId: string; operator: 'eq' | 'notEq'; value: string }
  | { kind: 'predicate'; fieldId: string; operator: 'isTrue' | 'isFalse'; value: boolean };

export type ImpactSeverity = 'info' | 'warning' | 'invalid';
export type ImpactConditionState =
  | 'reference-only'
  | 'scope-changed'
  | 'always-true'
  | 'impossible'
  | 'scope-partial'
  | 'invalid-value'
  | 'field-deleted';

export interface ImpactChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

export interface ImpactedCondition {
  ruleId: string;
  ruleName: string;
  path: number[];
  fieldId: string;
  fieldName: string;
  operator: PredicateCondition['operator'];
  valueText: string;
  state: ImpactConditionState;
  severity: ImpactSeverity;
  reason: string;
  signature: string;
}

export interface ImpactedRuleSummary {
  ruleId: string;
  ruleName: string;
  conditionCount: number;
  warningCount: number;
  invalidCount: number;
}

export interface FieldImpactReport {
  action: 'update' | 'delete';
  fieldId: string;
  fieldName: string;
  nextField?: RuleField;
  changes: ImpactChange[];
  impactedRules: ImpactedRuleSummary[];
  conditions: ImpactedCondition[];
  counts: {
    rules: number;
    conditions: number;
    info: number;
    warning: number;
    invalid: number;
  };
}

export interface FieldImpactReview {
  id: string;
  fieldId: string;
  fieldName: string;
  action: 'update' | 'delete';
  changedAt: number;
  changes: ImpactChange[];
  conditions: ImpactedCondition[];
  acknowledgedConditionKeys: string[];
}

export interface ConditionGroup {
  kind: 'group';
  operator: 'and' | 'or';
  conditions: RuleCondition[];
}

export type RuleCondition = PredicateCondition | ConditionGroup;

export interface BusinessRule {
  id: string;
  name: string;
  conditions: ConditionGroup;
  priority: number;
  result: string;
}

export type SampleInput = Record<string, ScalarValue | ''>;

export interface RuleVersion {
  id: string;
  name: string;
  savedAt: number;
  frozen: boolean;
  fields: RuleField[];
  rules: BusinessRule[];
  sampleInputs: SampleInput;
}

export interface RuleProject {
  id: string;
  title: string;
  fields: RuleField[];
  rules: BusinessRule[];
  sampleInputs: SampleInput;
  versions: RuleVersion[];
  impactReviews?: FieldImpactReview[];
  frozenVersionId?: string;
  updatedAt: number;
}

export interface WorkspaceDocument {
  schemaVersion: 1;
  projects: RuleProject[];
  activeProjectId: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  fieldId?: string;
  ruleId?: string;
}

export interface MatchWitness {
  values: SampleInput;
  ruleIds: string[];
}

export interface RuleOverlap {
  ruleAId: string;
  ruleBId: string;
  conflict: boolean;
  witness: SampleInput;
}

export interface RuleAnalysis {
  checkedCases: number;
  coveredCases: number;
  coveragePercent: number;
  overlaps: RuleOverlap[];
  unreachableRuleIds: string[];
  shadowedRuleIds: string[];
  uncoveredExamples: SampleInput[];
  truncated: boolean;
}

export interface SampleEvaluation {
  valid: boolean;
  errors: string[];
  matchedRules: BusinessRule[];
  winner?: BusinessRule;
}

export interface DomainChecker {
  analyze(project: RuleProject): RuleAnalysis;
  validateProject(project: RuleProject): ValidationIssue[];
}

export const fieldLabel = (field: RuleField): string => field.name || '未命名字段';
