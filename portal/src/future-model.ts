/**
 * Forward-looking data model (tables are created in schema.ts).
 * Do not wire product features yet — this file is documentation for later work.
 *
 * watch_events
 *   One row per playback session (or heartbeat sample) on a paired device.
 *   Use content_kind 'watch' | 'shorts' to split reports.
 *
 * daily_time_limits
 *   weekday: 0 (Sunday) … 6 (Saturday)
 *   limit_minutes: cap for that weekday; null/missing row = no cap.
 *   Apply in the extension after syncing, independent of allowlists.
 *
 * channel_age_analysis
 *   Cache of an age-appropriateness pass over a channel (labels JSON, notes,
 *   suggested_min_age). Populate from a future worker; the extension can show
 *   a badge but must not treat missing analysis as "safe".
 */
export const FUTURE_FEATURES = [
  "watch_history_and_stats",
  "per_weekday_daily_time_limits",
  "channel_age_appropriateness_analysis",
] as const;
