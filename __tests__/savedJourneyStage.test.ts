import { presentSavedJourneyStage, savedJourneyTimelineHighlight, savedJourneyTimelineNames } from '../src/modules/journey/savedJourneyStage';
import { normalizeAutomaticJourneySnapshot, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
import type { RouteInfo } from '../src/modules/schedule/routeInfo';

const binding: AutomaticJourneyBinding = { sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '9001',
    generation: 1, routeRevision: 1, clientOwnerId: '22222222-2222-4222-8222-222222222222', routeInputDigest: 'a'.repeat(64),
    execution: 'SIMULATOR', syncScope: 'SANDBOX', savedRouteValidated: true, guidanceEnabled: true,
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600 };
const input = { routeRevision: 1, legs: ['WALK', 'BUS', 'WALK'].map((kind, index) => ({ index, kind,
    stops: index === 1 ? [{ name: '구로역' }] : [] })) } as JourneyRouteInput;
const metadata = { ...binding, legs: input.legs.map(leg => ({ index: leg.index, kind: leg.kind,
    ...(leg.index === 0 ? { walkingLengthMeters: 200 } : leg.index === 1 ? { boardingStopName: '구로역' } : {}) })) };
const snapshot = (patch = {}, route: unknown = metadata) => ({ enabled: true, status: 'ACTIVE', sessionId: binding.sessionId, routeRevision: 1,
    guidanceRoute: route, guidance: { ...binding, schemaVersion: 1, sequence: 10, status: 'ACTIVE', phase: 'WALKING_TO_STOP', quality: 'GOOD',
        activeLegIndex: 0, walkProgress: 0.5, observedAt: 1020, validUntil: 1035, boardingConfirmed: false, ...patch } }) as unknown as AutomaticJourneySnapshot;
const stage = (patch = {}, now = 1021, route: unknown = metadata) => presentSavedJourneyStage(snapshot(patch, route), binding, input, now);
it('matches native stage/distance copy and never advances with time', () => {
    expect(stage()).toEqual({ title: '구로역까지', action: '도보 약 100m', activeLegIndex: 0 });
    expect(stage({}, 1034)).toEqual(stage());
    expect(stage({ walkProgress: 0.6 })?.action).toBe('도보 약 80m');
    expect(stage({ walkProgress: 0.51 })?.action).toBe('도보 약 100m');
    expect(stage({ walkProgress: 1 })?.action).toBe('승차 지점 근처');
    expect(JSON.stringify(stage())).not.toContain('%');
    expect(normalizeAutomaticJourneySnapshot(snapshot()).guidanceRoute).toEqual(metadata);
});
it('waiting is at the boarding place but never claims a ride or next stop', () => {
    expect(stage({ phase: 'WAITING', activeLegIndex: 1, walkProgress: 1 }))
        .toEqual({ title: '구로역', action: '버스 대기 · 도착하면 탑승 준비', activeLegIndex: 1 });
});
it('shows only the saved and native-matched alighting stop during a confirmed bus ride', () => {
    const saved = { ...input, legs: input.legs.map(leg => leg.index === 1
        ? { ...leg, stops: [{ name: '구로역' }, { name: '경복궁역' }], display: { lineName: '1711' } } : leg) } as JourneyRouteInput;
    const route = { ...metadata, legs: metadata.legs.map(leg => leg.index === 1
        ? { ...leg, lineName: '1711', alightingStopName: '경복궁역' } : leg) };
    const ride = { schemaVersion: 2, phase: 'RIDING', activeLegIndex: 1, walkProgress: null,
        rideProgress: 0.5, boardingConfirmed: true };
    expect(presentSavedJourneyStage(snapshot(ride, route), binding, saved, 1021))
        .toEqual({ title: '1711', action: '경복궁역에서 하차', activeLegIndex: 1 });
    const wrong = { ...route, legs: route.legs.map(leg => leg.index === 1
        ? { ...leg, alightingStopName: '다른 정류장' } : leg) };
    expect(presentSavedJourneyStage(snapshot(ride, wrong), binding, saved, 1021)?.action).toBe('버스로 이동 중');
});
it.each(['sessionId', 'scheduleId', 'generation', 'routeRevision', 'routeInputDigest'])('rejects display metadata from another %s', key => {
    const foreign = { ...metadata, [key]: key === 'generation' || key === 'routeRevision' ? 2 : 'foreign' };
    expect(stage({}, 1021, foreign)).toEqual({ title: '승차 지점까지', action: '도보로 이동 중', activeLegIndex: 0 });
});
it('missing or malformed metadata cannot invent a place or geometry length', () => {
    for (const route of [null, {}, { ...metadata, legs: [] }, { ...metadata, legs: metadata.legs.map(leg => ({ ...leg, index: 4 })) }]) {
        expect(stage({}, 1021, route)?.action).toBe('도보로 이동 중');
        expect(stage({}, 1021, route)?.title).toBe('승차 지점까지');
    }
    for (const length of [undefined, NaN, Infinity, -1, 100_001]) {
        expect(stage({}, 1021, { ...metadata, legs: [{ ...metadata.legs[0], walkingLengthMeters: length }, ...metadata.legs.slice(1)] })?.action).toBe('도보로 이동 중');
    }
    for (const name of ['다른 정류장', '구로\n역', 'a'.repeat(257), '']) {
        expect(stage({}, 1021, { ...metadata, legs: [metadata.legs[0], { ...metadata.legs[1], boardingStopName: name }, metadata.legs[2]] })?.title).toBe('승차 지점까지');
    }
});
it.each([{ phase: 'BOARDING_CANDIDATE', quality: 'UNCERTAIN' }, { quality: 'UNAVAILABLE' }, { observedAt: 1030 },
    { activeLegIndex: 1 }, { walkProgress: NaN }, { walkProgress: 1.1 }])('uncertainty removes the current step and distance %j', patch => {
    expect(stage(patch)?.activeLegIndex).toBeNull();
    expect(stage(patch)?.title).toBe('위치 확인 중');
});
it('explains a rejected first-walk corridor without claiming a current route position', () => {
    const unavailable = { phase: 'UNAVAILABLE', quality: 'UNCERTAIN', walkProgress: null };
    const offRoute = { ...snapshot(unavailable), qualityReason: 'OFF_ROUTE' } as AutomaticJourneySnapshot;
    expect(presentSavedJourneyStage(offRoute, binding, input, 1021)).toEqual({
        title: '경로 확인 중', action: '경로를 벗어난 것 같아요 · 위치 확인 중', activeLegIndex: null,
    });
    const busOffRoute = { ...snapshot(unavailable), busReason: 'BUS_OFF_ROUTE' } as AutomaticJourneySnapshot;
    expect(presentSavedJourneyStage(busOffRoute, binding, input, 1021)?.title).toBe('경로 확인 중');
    expect(presentSavedJourneyStage({ ...offRoute, ridePhase: 'RIDING' }, binding, input, 1021)?.title).toBe('위치 확인 중');
    expect(presentSavedJourneyStage({ ...offRoute, subwayPhase: 'RIDING' }, binding, input, 1021)?.title).toBe('위치 확인 중');
});
it('expiry hides the current step; foreign content or terminal session returns nothing', () => {
    expect(stage({}, 1035)?.activeLegIndex).toBeNull();
    expect(stage({ generation: 2 })).toBeNull();
    expect(presentSavedJourneyStage({ ...snapshot(), status: 'STOPPED' }, binding, input, 1021)).toBeNull();
});
it('timeline mapping uses every original id/kind, not display names or endpoint offsets', () => {
    const route = { steps: [{ id: 'origin', type: 'ORIGIN' }, ...input.legs.map(leg => ({ id: `leg-${leg.index}`, type: leg.kind })),
        { id: 'destination', type: 'DESTINATION' }] } as RouteInfo;
    expect(savedJourneyTimelineHighlight(stage(), input, route)?.stepId).toBe('leg-0');
    expect(savedJourneyTimelineHighlight(stage({ phase: 'WAITING', activeLegIndex: 1, walkProgress: 1 }), input, route)?.stepId).toBe('leg-1');
    expect(savedJourneyTimelineHighlight(stage({}, 1035), input, route)).toBeUndefined();
    for (const changed of [route.steps.slice(1, 3), route.steps.map(step => step.id === 'leg-1' ? { ...step, id: 'leg-8' } : step),
        route.steps.map(step => step.id === 'leg-1' ? { ...step, type: 'SUBWAY' as const } : step)]) {
        expect(savedJourneyTimelineHighlight(stage(), input, { ...route, steps: changed })).toBeUndefined();
    }
});
it('preserves the full name only for exact id/kind mapping', () => {
    const named = { ...input, legs: input.legs.map(leg => ({ ...leg, display: { lineName: '길고 긴 전체 광역버스 이름 12345', lineColor: null, durationMinutes: null, distanceMeters: null } })) };
    const route = { steps: named.legs.map(leg => ({ id: `leg-${leg.index}`, type: leg.kind })) } as RouteInfo;
    expect(savedJourneyTimelineNames(named, route)).toEqual({ 'leg-1': '길고 긴 전체 광역버스 이름 12345' });
    expect(savedJourneyTimelineNames(named, { ...route, steps: route.steps.slice(1) })).toEqual({});
    expect(savedJourneyTimelineNames(named, { ...route, steps: route.steps.map(step => ({ ...step, id: 'wrong' })) })).toEqual({});
});
