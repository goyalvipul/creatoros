import type { ClipState } from './enums';

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
  stage: string;
  reason: string;
}

/** Non-binding hint of the next project stage; the owner always makes the change. */
export function suggestNextStage(
  current: string,
  progress: ProjectProgress,
  hasApprovedFinal: boolean,
): StageSuggestion | null {
  if (current === 'APPROVED' && progress.running > 0)
    return { stage: 'GENERATING', reason: 'Clips are queued or running.' };
  if (current === 'GENERATING' && progress.total > 0 && progress.completed === progress.total)
    return { stage: 'EDITING', reason: 'Every scene has a selected final.' };
  if (current === 'QA' && hasApprovedFinal)
    return { stage: 'READY', reason: 'An approved final export exists.' };
  return null;
}
