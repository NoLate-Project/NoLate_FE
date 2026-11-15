import {internalPreviewRoutes, isPublicInternalPreviewRoute} from '../src/modules/navigation/internalPreviewRoutes';

const {readdirSync} = require('fs') as {
    readdirSync: (path: string, options: {recursive: boolean}) => string[];
};

test('every declared development preview has the same exact login exemption', () => {
    expect(new Set(internalPreviewRoutes).size).toBe(internalPreviewRoutes.length);
    expect(internalPreviewRoutes).not.toContain('journey-subway-observation');
    for (const name of internalPreviewRoutes) {
        expect(isPublicInternalPreviewRoute(['internal', name], true)).toBe(true);
        expect(isPublicInternalPreviewRoute(['internal', name], false)).toBe(false);
        expect(isPublicInternalPreviewRoute(['internal', name, 'extra'], true)).toBe(false);
    }
});

test('every internal screen is listed for a navigator guard', () => {
    const screens = readdirSync('app/internal', {recursive: true})
        .filter(file => file.endsWith('.tsx'))
        .map(file => file.replace(/\.tsx$/, '').replaceAll('\\', '/'))
        .sort();
    expect(screens).toEqual([...internalPreviewRoutes, 'quick-schedule-benchmark'].sort());
});

test.each([[], ['internal'], ['internal', 'unknown'], ['schedule', 'journey-subway-observation'],
    ['internal', 'journey-subway-observation-other']].map(segments => [segments]))('unlisted route is never public: %j', segments => {
    expect(isPublicInternalPreviewRoute(segments, true)).toBe(false);
});
