/**
 * Calendar navigation should visibly settle within this interaction budget.
 * The shorter configured duration leaves room for React's commit and one frame
 * handoff before the native animation starts.
 */
export const CALENDAR_INTERACTION_BUDGET_MS = 200;
export const CALENDAR_TRANSITION_DURATION_MS = 160;
