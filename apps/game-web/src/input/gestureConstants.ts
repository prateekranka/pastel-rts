/** CSS-point gesture thresholds (not backing-buffer pixels). */
export const TAP_MOVE_THRESHOLD_CSS = 10;
export const PAN_THRESHOLD_CSS = 12;
export const LONG_PRESS_MS = 450;
export const DOUBLE_TAP_MS = 300;

/** Minimum interactive target size in CSS points (Apple HIG). */
export const MIN_TOUCH_TARGET_CSS = 44;

/** Minimum finger hit radius for battlefield picking (half of 44pt target). */
export const MIN_FINGER_RADIUS_CSS = MIN_TOUCH_TARGET_CSS / 2;

/** Maximum units selected by double-tap same-archetype gesture. */
export const DOUBLE_TAP_SELECT_CAP = 24;

/** Local sandbox player id for command envelopes. */
export const LAB_LOCAL_PLAYER_ID = 'lab-local';
