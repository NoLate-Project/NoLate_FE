import { beyondAdmittedRoute } from '../src/modules/journey/journeyRerouteEligibility';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';

const point = (latitude: number, longitude: number) => ({ latitude, longitude });
const fix = (latitude: number, longitude: number) => ({ latitude, longitude, accuracyMeters: 8, observedAt: 1_800_000_000 });

it('does not search again at the boarding stop or the new route origin', () => {
    const origin = point(37.555, 126.9718);
    const boarding = point(37.555236, 126.972968);
    const route = { legs: [{ coordinates: [origin, boarding], start: origin, end: boarding }],
        walkingSnapshot: { walks: [{ points: [
            { lat: 37.555, lng: 126.9718 }, { lat: 37.555236, lng: 126.972968 },
        ] }] },
    } as unknown as JourneyRouteInput;
    expect(beyondAdmittedRoute(fix(boarding.latitude, boarding.longitude), route)).toBe(false);
    const replacement = { legs: [{ coordinates: [fix(37.555, 126.968), boarding],
        start: point(37.555, 126.968), end: boarding }] } as unknown as JourneyRouteInput;
    expect(beyondAdmittedRoute(fix(37.555, 126.968), replacement)).toBe(false);
});

it('allows a confirmed fix well outside all admitted geometry', () => {
    const route = { legs: [{ coordinates: [point(37.555, 126.9718), point(37.555236, 126.972968)],
        start: point(37.555, 126.9718), end: point(37.555236, 126.972968) }] } as unknown as JourneyRouteInput;
    expect(beyondAdmittedRoute(fix(37.555, 126.968), route)).toBe(true);
});
