/** Shared UI constants (shell layout, streaming follow-ups). */

/** Left sidebar width bounds (px). */
export const LAYOUT_LEFT_MIN = 180;
export const LAYOUT_LEFT_MAX = 340;
/** Documents sidebar width bounds (px). */
export const LAYOUT_RIGHT_MIN = 220;
export const LAYOUT_RIGHT_MAX = 440;
/** Citations / sources column when open (px). */
export const LAYOUT_SOURCES_WIDTH = 240;

export const LAYOUT_DEFAULT_LEFT = LAYOUT_LEFT_MIN;
export const LAYOUT_DEFAULT_RIGHT = LAYOUT_RIGHT_MIN;

/** After SSE `done` with RAGAS queued, poll messages until metrics are no longer pending. */
export const RAGAS_METRICS_POLL_INTERVAL_MS = 2500;
export const RAGAS_METRICS_POLL_MAX_ATTEMPTS = 20;
