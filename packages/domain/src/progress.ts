import type { ClipState, ProjectStage } from './enums';

export interface SceneLike {
  status: ClipState;
}

export interface ProjectProgress {
  total: number;
  completed: number;
  running: number;
  failed: number;
  planned: number;
  pct: number;
}

/**
 * Completion is an explicit decision: a clip counts as completed only when it is SELECTED
 * (approved final), never because an MP4 exists or a job SUCCEEDED.
 */
export function computeProjectProgress(scenes: SceneLike[]): ProjectProgress {
  const total = scenes.length;
  const completed = scenes.filter((s) => s.status === 'SELECTED').length;
  const running = scenes.filter((s) => s.status === 'RUNNING' || s.status === 'QUEUED').length;
  const failed = scenes.filter((s) => s.status === 'FAILED').length;
  const planned = scenes.filter((s) => s.status === 'PLANNED').length;
  return {
    total,
    completed,
    running,
    failed,
    planned,
    pct: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export interface StageSuggestion {
  stage: ProjectStage;
  reason: string;
}

/** Non-binding hint of the next project stage; the owner always makes the change. */
export function suggestNextStage(
  current: string,
  progress: ProjectProgress,
  hasApprovedFinal: boolean,
): StageSuggestion | null {
  if (current === 'DRAFT' && (progress.running > 0 || progress.completed > 0))
    return { stage: 'IN_PROGRESS', reason: 'Work has started on this project.' };
  if (current === 'IN_PROGRESS' && hasApprovedFinal)
    return { stage: 'READY', reason: 'An approved final export exists.' };
  if (current === 'READY') return { stage: 'PUBLISHED', reason: 'Mark published when the post is live.' };
  return null;
}
