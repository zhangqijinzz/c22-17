import { confirmImpactEntry, flattenImpactEntries } from '../../domain/fieldImpact';
import type { FieldImpactEntry } from '../../models/ruleModel';
import type { WorkspacePort } from '../../viewmodels/workspacePort';

export class ImpactReviewViewModel {
  constructor(private readonly workspace: WorkspacePort) {}

  entries(): FieldImpactEntry[] {
    const project = this.workspace.getSnapshot().project;
    return project ? flattenImpactEntries(project.fieldImpactReviews) : [];
  }

  confirm(entryId: string): void {
    const project = this.workspace.getSnapshot().project;
    if (!project) return;
    const next = confirmImpactEntry(project, entryId);
    const remaining = flattenImpactEntries(next.fieldImpactReviews).length;
    this.workspace.commitProject(next, remaining ? `已确认 1 个条件，还剩 ${remaining} 个待确认` : '所有受影响条件已确认', { recheck: true });
  }
}
