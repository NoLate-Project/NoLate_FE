/** Exact development-only routes; declaring a screen does not grant production access. */
export const internalPreviewRoutes = [
    'schedule-ui-preview', 'main-design-preview', 'input-design-preview',
    'live-activity-preview', 'eta-alarm-verification', 'journey-preview', 'journey-diagnostics',
    'journey-engine', 'journey-route-quality', 'journey-walk-adapter', 'journey-mixed-walking',
    'journey-automatic', 'journey-bus', 'journey-guidance', 'journey-readiness',
    'journey-subway-observation',
] as const;

export function isPublicInternalPreviewRoute(segments: readonly string[], development: boolean): boolean {
    return development === true && segments.length === 2 && segments[0] === 'internal'
        && internalPreviewRoutes.some(name => name === segments[1]);
}
