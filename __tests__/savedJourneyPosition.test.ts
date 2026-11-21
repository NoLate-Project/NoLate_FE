import { presentSavedJourneyOffRouteLocation, presentSavedJourneyPosition } from '../src/modules/journey/useSavedJourneyPosition';
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
jest.mock('../src/modules/journey/automaticJourneyTrial', () => ({ getAutomaticJourneyTrialBinding: jest.fn(), subscribeAutomaticJourneySync: jest.fn() }));
const binding = { sessionId: '11111111-1111-4111-8111-111111111111', scheduleId: '9001', generation: 1, routeRevision: 1,
    routeInputDigest: 'a'.repeat(64), syncScope: 'SANDBOX', savedRouteValidated: true, guidanceEnabled: true,
    preparedAtEpochSeconds: 1000, expiresAtEpochSeconds: 1600 } as AutomaticJourneyBinding;
const snapshot = { enabled: true, status: 'ACTIVE', sessionId: binding.sessionId, routeRevision: 1,
    guidance: { ...binding, status: 'ACTIVE', schemaVersion: 1, sequence: 1, phase: 'WAITING', quality: 'GOOD',
        boardingConfirmed: false, observedAt: 1020, validUntil: 1035, walkProgress: 1 },
    guidancePosition: { latitude: 37.5, longitude: 127, observedAt: 1020, validUntil: 1035, accuracyMeters: 5 } } as unknown as AutomaticJourneySnapshot;
it('uses only the same fresh accepted engine observation and never rebases TTL', () => {
    expect(presentSavedJourneyPosition(snapshot, binding, 1021)).toEqual({ latitude: 37.5, longitude: 127 });
    expect(presentSavedJourneyPosition(snapshot, binding, 1035)).toBeNull();
    expect(presentSavedJourneyPosition(snapshot, { ...binding, generation: 2 }, 1021)).toBeNull();
});
it.each([{ latitude: NaN }, { longitude: 181 }, { latitude: -91 }, { accuracyMeters: -1 }, { accuracyMeters: 36 }, { observedAt: 1019 }, { validUntil: 1040 }])('rejects unsafe/stale position %j', patch => {
    expect(presentSavedJourneyPosition({ ...snapshot, guidancePosition: { ...snapshot.guidancePosition, ...patch } }, binding, 1021)).toBeNull();
});
it.each(['BOARDING_CANDIDATE', 'UNAVAILABLE', 'READY'])('hides position for %s', phase => {
    expect(presentSavedJourneyPosition({ ...snapshot, guidance: { ...snapshot.guidance, phase, quality: 'UNCERTAIN' } }, binding, 1021)).toBeNull();
});
it('shows a fresh stationary passenger dot while departure is still armed', () => {
    const ready: AutomaticJourneySnapshot = { ...snapshot, status: 'ARMED', guidance: { ...snapshot.guidance,
        status: 'ARMED', phase: 'READY', quality: 'UNAVAILABLE', walkProgress: null, observedAt: null,
        validUntil: binding.expiresAtEpochSeconds } };
    expect(presentSavedJourneyPosition(ready, binding, 1021)).toEqual({latitude: 37.5, longitude: 127});
    expect(presentSavedJourneyPosition(ready, binding, 1035)).toBeNull();
    expect(presentSavedJourneyPosition(ready, binding, 1019)).toBeNull();
    expect(presentSavedJourneyPosition({ ...ready, guidancePosition: null }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyPosition(ready, { ...binding, generation: 2 }, 1021)).toBeNull();
    expect(presentSavedJourneyPosition({ ...ready, guidancePosition: { ...ready.guidancePosition, validUntil: 1050 } }, binding, 1021)).toBeNull();
});
it('stopped/unvalidated sessions cannot reveal location', () => {
    expect(presentSavedJourneyPosition({ ...snapshot, status: 'STOPPED' }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyPosition(snapshot, { ...binding, savedRouteValidated: undefined }, 1021)).toBeNull();
});
const offRoute = { ...snapshot, qualityReason: 'OFF_ROUTE', guidance: { ...snapshot.guidance, phase: 'UNAVAILABLE', quality: 'UNCERTAIN' },
    deviceMapLocation: { schemaVersion: 1, sessionId: binding.sessionId, generation: binding.generation,
        routeRevision: binding.routeRevision, routeInputDigest: binding.routeInputDigest,
        latitude: 37.565, longitude: 126.99, accuracyMeters: 5, observedAt: 1020, validUntil: 1035 } } as AutomaticJourneySnapshot;
it('shows a separately fenced device dot off route without promoting route progress', () => {
    expect(presentSavedJourneyPosition(offRoute, binding, 1021)).toBeNull();
    expect(presentSavedJourneyOffRouteLocation(offRoute, binding, 1021)).toEqual({ latitude: 37.565, longitude: 126.99 });
    expect(presentSavedJourneyOffRouteLocation(offRoute, binding, 1035)).toBeNull();
});
it('rejects foreign, unreliable, stopped and riding off-route map fixes', () => {
    expect(presentSavedJourneyOffRouteLocation({ ...offRoute, deviceMapLocation: { ...offRoute.deviceMapLocation, generation: 2 } }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyOffRouteLocation({ ...offRoute, deviceMapLocation: { ...offRoute.deviceMapLocation, accuracyMeters: 26 } }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyOffRouteLocation({ ...offRoute, deviceMapLocation: { ...offRoute.deviceMapLocation, validUntil: 1040 } }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyOffRouteLocation({ ...offRoute, status: 'STOPPED' }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyOffRouteLocation({ ...offRoute, ridePhase: 'RIDING' }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyOffRouteLocation({ ...offRoute, qualityReason: 'TRACKING' }, binding, 1021)).toBeNull();
});
