import type { Priority } from './enums';

export interface PriorityCandidate {
  id: string;
  kind: string;
  title: string;
  dueAt?: Date | string | null;
  priority?: Priority | null;
  /** Deal value impact in major currency units (not minor). */
  dealValue?: number | null;
  /** 0..1 completion readiness. */
  readiness?: number | null;
  blockedBy?: number | null;
  pinned?: boolean;
  snoozedUntil?: Date | string | null;
}

export interface ScoredCandidate extends PriorityCandidate {
  score: number;
  reasons: string[];
}

const PRIORITY_POINTS: Record<Priority, number> = { URGENT: 40, HIGH: 25, NORMAL: 10, LOW: 0 };

function hoursLabel(h: number): string {
  const a = Math.abs(h);
  if (a < 1) return 'less than an hour';
  if (a < 48) return `${Math.round(a)}h`;
  return `${Math.round(a / 24)}d`;
}

/**
 * Deterministic "what should I do next" score. No randomness, no AI. Every point is explained in `reasons`.
 */
export function scoreCandidate(c: PriorityCandidate, now: Date = new Date()): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;
  if (c.pinned) {
    score += 1000;
    reasons.push('Pinned manually');
  }
  if (c.dueAt) {
    const due = new Date(c.dueAt).getTime();
    const hrs = (due - now.getTime()) / 3_600_000;
    if (hrs < 0) {
      score += 60 + Math.min(30, -hrs / 12);
      reasons.push(`Overdue by ${hoursLabel(hrs)}`);
    } else if (hrs <= 24) {
      score += 45;
      reasons.push(`Due in ${hoursLabel(hrs)}`);
    } else if (hrs <= 72) {
      score += 30;
      reasons.push(`Due in ${hoursLabel(hrs)}`);
    } else if (hrs <= 168) {
      score += 15;
      reasons.push(`Due in ${hoursLabel(hrs)}`);
    }
  }
  if (c.priority && PRIORITY_POINTS[c.priority]) {
    score += PRIORITY_POINTS[c.priority];
    reasons.push(`${c.priority.toLowerCase()} priority`);
  }
  if (c.dealValue && c.dealValue > 0) {
    const pts = Math.min(25, Math.log10(c.dealValue + 1) * 6);
    score += pts;
    reasons.push('Linked to a deal with money at stake');
  }
  if (c.readiness != null && c.readiness > 0) {
    score += 10 * Math.min(1, c.readiness);
    if (c.readiness >= 0.7) reasons.push('Close to completion');
  }
  if (c.blockedBy && c.blockedBy > 0) {
    score -= 30;
    reasons.push(`Blocked by ${c.blockedBy} dependency${c.blockedBy > 1 ? ' items' : ''}`);
  }
  if (reasons.length === 0) reasons.push('No deadline or signal yet; ordered by creation time');
  return { ...c, score: Math.round(score * 100) / 100, reasons };
}

export function rankCandidates(items: PriorityCandidate[], now: Date = new Date(), limit = 3): ScoredCandidate[] {
  return items
    .filter((i) => !i.snoozedUntil || new Date(i.snoozedUntil).getTime() <= now.getTime())
    .map((i) => scoreCandidate(i, now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}
