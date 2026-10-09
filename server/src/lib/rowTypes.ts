// The FIXED catalogue of homepage row types. This list is the whole vocabulary —
// there is deliberately no free-text query field anywhere in the row builder.
// Row queries are code (see buildRowItems in homepageCache.ts), not configuration.

export interface RowTypeDef {
  key: string;
  label: string;
  /** One line describing exactly what the row returns — shown in the Add row picker. */
  description: string;
  /** Personal rows depend on the signed-in viewer, so the shared cache skips them
   *  and the client fetches them in Stage 2 (see PROMPT 09's three-stage load). */
  personal: boolean;
  defaultCardStyle: "poster" | "landscape" | "numbered" | "tile" | "speaker";
  /** Params this row type understands, if any. Anything else is ignored. */
  params?: { key: string; label: string; type: "number" | "text" }[];
}

export const ROW_TYPES: RowTypeDef[] = [
  { key: "live_now", label: "Live Now", description: "Sessions currently streaming, newest first.", personal: false, defaultCardStyle: "landscape" },
  { key: "starting_soon", label: "Starting Soon", description: "Sessions starting within the next 2 hours.", personal: false, defaultCardStyle: "landscape" },
  { key: "my_upcoming", label: "My Upcoming", description: "Sessions the viewer has registered for that haven't started.", personal: true, defaultCardStyle: "landscape" },
  { key: "this_week", label: "This Week", description: "Everything scheduled between now and the end of the week.", personal: false, defaultCardStyle: "poster" },
  { key: "just_added", label: "Just Added", description: "Most recently published content across all types.", personal: false, defaultCardStyle: "poster" },
  { key: "continue_watching", label: "Continue Watching", description: "Replays the viewer started but didn't finish.", personal: true, defaultCardStyle: "landscape" },
  { key: "continue_learning", label: "Continue Learning", description: "Courses the viewer is enrolled in with lessons remaining.", personal: true, defaultCardStyle: "landscape" },
  { key: "almost_done", label: "Almost Done", description: "Courses the viewer is over 75% through.", personal: true, defaultCardStyle: "landscape" },
  { key: "missed_live", label: "Missed Live", description: "Sessions the viewer registered for but didn't attend, now available as replays.", personal: true, defaultCardStyle: "landscape" },
  { key: "my_courses", label: "My Courses", description: "Every course the viewer is enrolled in.", personal: true, defaultCardStyle: "poster" },
  { key: "in_my_plan", label: "In My Plan", description: "Subscriber-tier content included with the viewer's current plan.", personal: true, defaultCardStyle: "poster" },
  { key: "free_this_week", label: "Free This Week", description: "Public and registered-tier content published in the last 7 days.", personal: false, defaultCardStyle: "poster" },
  { key: "upgrade_teaser", label: "Upgrade Teaser", description: "Subscriber-only content shown to non-subscribers, locked.", personal: false, defaultCardStyle: "poster" },
  { key: "top_ten", label: "Top 10", description: "The ten most-viewed items overall, rank-numbered.", personal: false, defaultCardStyle: "numbered" },
  { key: "popular_in_industry", label: "Popular in Your Industry", description: "Most-registered content matching the viewer's industry.", personal: false, defaultCardStyle: "poster", params: [{ key: "industry", label: "Industry", type: "text" }] },
  { key: "category_tiles", label: "Browse Categories", description: "Category tiles flagged to show on the homepage.", personal: false, defaultCardStyle: "tile" },
  { key: "similar_to_watched", label: "Because You Watched", description: "Content sharing categories with the viewer's recent history.", personal: false, defaultCardStyle: "poster" },
  { key: "under_30_min", label: "Under 30 Minutes", description: "Content with a runtime below 30 minutes.", personal: false, defaultCardStyle: "landscape" },
  { key: "audio_available", label: "Listen On The Go", description: "Content with an audio-only track attached.", personal: false, defaultCardStyle: "landscape" },
  { key: "highest_rated", label: "Highest Rated", description: "Content with the best average rating, minimum 3 ratings.", personal: false, defaultCardStyle: "poster" },
  { key: "most_attended", label: "Most Attended", description: "Sessions with the highest confirmed attendance.", personal: false, defaultCardStyle: "poster" },
  { key: "featured_speakers", label: "Featured Speakers", description: "Active speakers, most recent first.", personal: false, defaultCardStyle: "speaker" },
  { key: "by_speaker", label: "By Speaker", description: "All content from one specific speaker.", personal: false, defaultCardStyle: "poster", params: [{ key: "speaker_id", label: "Speaker ID", type: "number" }] },
  { key: "new_instructors", label: "New Instructors", description: "Speakers who joined in the last 60 days.", personal: false, defaultCardStyle: "speaker" },
];

export const ROW_TYPE_KEYS = ROW_TYPES.map((r) => r.key);

const BY_KEY = new Map(ROW_TYPES.map((r) => [r.key, r]));

export function getRowType(key: string): RowTypeDef | undefined {
  return BY_KEY.get(key);
}

export function isPersonalRow(key: string): boolean {
  return BY_KEY.get(key)?.personal ?? false;
}

/** Condition types the ordering-rule engine understands, with plain-English labels. */
export const CONDITION_TYPES: { key: string; label: string; description: string; needsValue: boolean; valueLabel?: string }[] = [
  { key: "live_exists", label: "A session is live now", description: "Fires whenever any session is currently streaming.", needsValue: false },
  { key: "session_within_hours", label: "Viewer has a session within N hours", description: "Fires when the viewer is registered for a session starting soon.", needsValue: true, valueLabel: "Hours" },
  { key: "course_progress_gte", label: "Course progress at or above N%", description: "Fires when the viewer is near the end of a course.", needsValue: true, valueLabel: "Percent" },
  { key: "incomplete_progress", label: "Viewer has unfinished content", description: "Fires when anything is partly watched.", needsValue: false },
  { key: "unwatched_replay", label: "Viewer has an unwatched replay", description: "Fires when a registered session ended and the replay is unopened.", needsValue: false },
  { key: "inactive_days", label: "Inactive for N days", description: "Fires when the viewer hasn't watched anything recently.", needsValue: true, valueLabel: "Days" },
  { key: "logged_out", label: "Viewer is signed out", description: "Fires for anonymous visitors.", needsValue: false },
  { key: "never_purchased", label: "Viewer has never purchased", description: "Fires for viewers with no orders or subscriptions.", needsValue: false },
];
