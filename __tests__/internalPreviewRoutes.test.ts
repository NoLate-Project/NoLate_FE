import {internalPreviewRoutes, isPublicInternalPreviewRoute} from '../src/modules/navigation/internalPreviewRoutes';

test('every declared development preview has the same exact login exemption', () => {
    expect(new Set(internalPreviewRoutes).size).toBe(internalPreviewRoutes.length);
    expect(internalPreviewRoutes).toContain('journey-subway-observation');
    for (const name of internalPreviewRoutes) {
        expect(isPublicInternalPreviewRoute(['internal', name], true)).toBe(true);
        expect(isPublicInternalPreviewRoute(['internal', name], false)).toBe(false);
        expect(isPublicInternalPreviewRoute(['internal', name, 'extra'], true)).toBe(false);
    }
});
test.each([[], ['internal'], ['internal', 'unknown'], ['schedule', 'journey-subway-observation'],
    ['internal', 'journey-subway-observation-other']].map(segments => [segments]))('unlisted route is never public: %j', segments => {
    expect(isPublicInternalPreviewRoute(segments, true)).toBe(false);
});
