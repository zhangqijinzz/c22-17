import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { RulesViewModel } from '../features/rules/rulesViewModel';
import { RuleWorkspaceViewModel } from './workspaceViewModel';
import { SamplesViewModel } from '../features/samples/samplesViewModel';
import { ImpactViewModel } from '../features/impact/ImpactViewModel';
import { InspectionViewModel } from '../features/inspection/inspectionViewModel';

export function createRuleWeaveViewModels() {
  const workspace = new RuleWorkspaceViewModel();
  const impact = new ImpactViewModel(workspace);
  return {
    workspace,
    fields: new FieldsViewModel(workspace),
    rules: new RulesViewModel(workspace),
    samples: new SamplesViewModel(workspace),
    inspection: new InspectionViewModel(workspace),
    impact,
  };
}
