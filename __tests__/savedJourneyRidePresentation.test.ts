import { presentSavedJourneyGuidance } from '../src/modules/journey/savedJourneyGuidance';
import { presentSavedJourneyRoutePosition } from '../src/modules/journey/savedJourneyRoutePosition';
import { presentSavedJourneyStage, savedJourneyTimelineHighlight } from '../src/modules/journey/savedJourneyStage';
import { presentSavedJourneyPosition } from '../src/modules/journey/useSavedJourneyPosition';
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
import type { RouteInfo } from '../src/modules/schedule/routeInfo';
jest.mock('../src/modules/journey/automaticJourneyTrial', () => ({ getAutomaticJourneyTrialBinding: jest.fn(), subscribeAutomaticJourneySync: jest.fn() }));
const binding = { sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '9001', generation: 1, routeRevision: 1,
    routeInputDigest: 'a'.repeat(64), syncScope: 'AUTHENTICATED', savedRouteValidated: true, guidanceEnabled: true,
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600 } as AutomaticJourneyBinding;
const input = { routeRevision: 1, legs: ['WALK', 'BUS', 'WALK'].map((kind, index) => ({ index, kind,
    display: { lineName: index === 1 ? '7016' : null, durationMinutes: index === 1 ? 5 : 2, lineColor: null, distanceMeters: null } })) } as JourneyRouteInput;
const metadata = { ...binding, legs: input.legs.map(leg => ({ index: leg.index, kind: leg.kind, ...leg.display })) };
const snapshot = (patch = {}) => ({ enabled: true, status: 'ACTIVE', sessionId: binding.sessionId, routeRevision: 1, guidanceRoute: metadata,
    guidance: { ...binding, schemaVersion: 2, sequence: 20, status: 'ACTIVE', phase: 'RIDING', quality: 'GOOD',
        boardingConfirmed: true, activeLegIndex: 1, rideProgress: 0.5, walkProgress: null, observedAt: 1020, validUntil: 1025, ...patch },
    guidancePosition: { latitude: 37.5, longitude: 127, accuracyMeters: 5, observedAt: 1020, validUntil: 1025 } }) as unknown as AutomaticJourneySnapshot;
it('shows confirmed native ride in the bus segment, map and timeline with no invented next stop or ETA', () => {
    const s = snapshot(), stage = presentSavedJourneyStage(s, binding, input, 1021);
    expect(presentSavedJourneyGuidance(s, binding, 1021)).toEqual({ phase: 'RIDING', instruction: '버스로 이동 중', progress: 0.5, fresh: true });
    expect(presentSavedJourneyRoutePosition(s, binding, input, 1021)).toEqual({ legIndex: 1, legProgress: 0.5,
        barFraction: 2/9 + 0.5 * 5/9, waiting: false });
    expect(presentSavedJourneyPosition(s, binding, 1021)).toEqual({ latitude: 37.5, longitude: 127 });
    expect(stage).toEqual({ title: '7016', action: '버스로 이동 중', activeLegIndex: 1 });
    const route = { steps: input.legs.map(leg => ({ id: `leg-${leg.index}`, type: leg.kind })) } as RouteInfo;
    expect(savedJourneyTimelineHighlight(stage, input, route)?.stepId).toBe('leg-1');
    expect(JSON.stringify(stage)).not.toMatch(/%|다음 정류장|하차하세요/);
});
it.each([{ schemaVersion: 1 }, { boardingConfirmed: false }, { activeLegIndex: 0 }, { walkProgress: 1 },
    { generation: 2 }, { rideProgress: NaN }, { rideProgress: -1 }, { rideProgress: 1.1 }, { rideProgress: null },
    { quality: 'UNCERTAIN' }, { validUntil: 1036 }, { observedAt: 1030 }])('hides unverified or contradictory ride %j', patch => {
    expect(presentSavedJourneyRoutePosition(snapshot(patch), binding, input, 1021)).toBeNull();
    expect(presentSavedJourneyPosition(snapshot(patch), binding, 1021)).toBeNull();
});
it('clock passing cannot move a marker; vehicle deadline, terminal state and local-only remove it', () => {
    expect(presentSavedJourneyRoutePosition(snapshot(), binding, input, 1021)).toEqual(presentSavedJourneyRoutePosition(snapshot(), binding, input, 1024));
    expect(presentSavedJourneyRoutePosition(snapshot(), binding, input, 1025)).toBeNull();
    expect(presentSavedJourneyStage(snapshot(), binding, input, 1025)?.activeLegIndex).toBeNull();
    expect(presentSavedJourneyGuidance({ ...snapshot(), status: 'STOPPED' }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyGuidance(snapshot(), { ...binding, syncScope: 'LOCAL_ONLY' }, 1021)).toBeNull();
});
