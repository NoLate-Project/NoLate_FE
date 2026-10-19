import { presentSavedJourneyPosition } from '../src/modules/journey/useSavedJourneyPosition';
import { buildGuidancePreviewSVG } from '../src/modules/journey/SavedJourneyRoutePreview';
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
jest.mock('../src/modules/journey/automaticJourneyTrial', () => ({ getAutomaticJourneyTrialBinding: jest.fn(), subscribeAutomaticJourneySync: jest.fn() }));
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
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
it('stopped/unvalidated sessions cannot reveal location', () => {
    expect(presentSavedJourneyPosition({ ...snapshot, status: 'STOPPED' }, binding, 1021)).toBeNull();
    expect(presentSavedJourneyPosition(snapshot, { ...binding, savedRouteValidated: undefined }, 1021)).toBeNull();
});
const input = { legs: [{ kind: 'WALK', coordinates: [{ latitude: 37.5, longitude: 127 }, { latitude: 37.5, longitude: 127.001 }] },
    { kind: 'BUS', coordinates: [{ latitude: 37.5, longitude: 127.001 }, { latitude: 37.51, longitude: 127.01 }] }] } as JourneyRouteInput;
it('renders all validated leg geometry without scripts, remote resources or injecting route names', () => {
    const svg = buildGuidancePreviewSVG(input, { latitude: 37.5, longitude: 127 });
    expect(svg?.match(/polyline/g)).toHaveLength(2); expect(svg?.match(/circle/g)).toHaveLength(3);
    expect(svg).not.toMatch(/script|href=|<image/);
    expect(buildGuidancePreviewSVG(input, null)?.match(/circle/g)).toHaveLength(2);
    expect(buildGuidancePreviewSVG({ ...input, legs: [{ ...input.legs[0], coordinates: [null] }] }, null)).toBeNull();
});
