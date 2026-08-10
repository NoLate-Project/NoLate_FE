const PREVIEW_GENERATION = 1;
const PREVIEW_ACTION_EVENT_KEY = `key:${"a".repeat(64)}`;

/** Development fixture identity: revision changes are content updates, not new activities. */
export function buildLiveActivityPreviewIdentity(revision: number) {
    return {
        generation: PREVIEW_GENERATION,
        revision: Math.max(1, Math.round(revision)),
        actionEventKey: PREVIEW_ACTION_EVENT_KEY,
    } as const;
}
