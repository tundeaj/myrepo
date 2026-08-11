// notification_preferences rows are per-user (user_id NOT NULL), so the SEED block in
// PROMPT 01-C — a fixed list of event_keys — has nothing global to write to the table.
// This is the canonical list; apply it per-user at signup (one row per event_key ×
// channel, is_enabled=true) rather than seeding it once.
export const NOTIFICATION_EVENT_KEYS = [
  "session_reminder",
  "session_starting",
  "replay_ready",
  "new_in_category",
  "course_updated",
  "community_reply",
  "assignment_feedback",
  "payment_receipt",
  "payment_failed",
  "certificate_issued",
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];
