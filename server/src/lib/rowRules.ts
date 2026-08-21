// Ordering rules promote a row to the top of the page when a condition about the
// viewer holds. The simulator in the admin and the live homepage assembly both
// call evaluateRules, so what a producer previews is what a viewer gets.

export interface ViewerState {
  logged_out: boolean;
  live_exists: boolean;
  /** Hours until the viewer's next registered session; null when they have none. */
  next_session_in_hours: number | null;
  /** Highest course completion percentage across the viewer's enrolments, 0–100. */
  max_course_progress: number;
  has_incomplete_progress: boolean;
  has_unwatched_replay: boolean;
  /** Days since the viewer last watched anything; null when they never have. */
  days_inactive: number | null;
  never_purchased: boolean;
}

export const DEFAULT_VIEWER_STATE: ViewerState = {
  logged_out: false,
  live_exists: false,
  next_session_in_hours: null,
  max_course_progress: 0,
  has_incomplete_progress: false,
  has_unwatched_replay: false,
  days_inactive: null,
  never_purchased: true,
};

export interface Rule {
  id: number;
  rule_key: string | null;
  description: string;
  condition_type: string | null;
  condition_value: number | null;
  promote_row_key: string | null;
  priority: number | null;
  is_enabled: boolean;
}

export function conditionMatches(rule: Rule, state: ViewerState): boolean {
  const value = rule.condition_value;
  switch (rule.condition_type) {
    case "live_exists":
      return state.live_exists;
    case "session_within_hours":
      return state.next_session_in_hours != null && value != null && state.next_session_in_hours <= value;
    case "course_progress_gte":
      return value != null && state.max_course_progress >= value;
    case "incomplete_progress":
      return state.has_incomplete_progress;
    case "unwatched_replay":
      return state.has_unwatched_replay;
    case "inactive_days":
      return state.days_inactive != null && value != null && state.days_inactive >= value;
    case "logged_out":
      return state.logged_out;
    case "never_purchased":
      return state.never_purchased;
    default:
      return false;
  }
}

export interface OrderedRow {
  row_key: string | null;
  label: string | null;
  display_order: number;
  /** Set when a rule moved this row; carries the rule that did it. */
  promoted_by?: { rule_id: number; description: string };
}

/**
 * Applies enabled rules in priority order. Each firing rule lifts its row to the
 * front; because rules are applied lowest-priority first, the highest-priority
 * firing rule ends up at the very top.
 */
export function evaluateRules<T extends { row_key: string | null; label: string | null; display_order: number }>(
  rows: T[],
  rules: Rule[],
  state: ViewerState,
): { ordered: (T & { promoted_by?: { rule_id: number; description: string } })[]; fired: Rule[] } {
  const base = [...rows].sort((a, b) => a.display_order - b.display_order);
  const result: (T & { promoted_by?: { rule_id: number; description: string } })[] = base.map((r) => ({ ...r }));

  const enabled = rules
    .filter((r) => r.is_enabled && r.promote_row_key)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const fired: Rule[] = [];

  for (const rule of enabled) {
    if (!conditionMatches(rule, state)) continue;
    const idx = result.findIndex((r) => r.row_key === rule.promote_row_key);
    if (idx === -1) continue; // rule names a row this surface doesn't have — silently skipped
    fired.push(rule);
    const [row] = result.splice(idx, 1);
    row.promoted_by = { rule_id: rule.id, description: rule.description };
    result.unshift(row);
  }

  return { ordered: result, fired };
}
