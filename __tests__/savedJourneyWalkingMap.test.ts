import { presentSavedJourneyWalkingMap } from '../src/modules/journey/savedJourneyWalkingMap';
import { composeServerWalkingInput, type WalkingSnapshot } from '../src/modules/journey/serverWalkingSnapshot';
import { buildSavedRouteMapPresentation, getSavedRouteFitCoords } from '../src/modules/map/savedRouteMapPresentation';
import { buildGuidancePreviewSVG } from '../src/modules/journey/SavedJourneyRoutePreview';
import { savedJourneyProviderFixture } from '../test-support/savedJourneyProviderFixture';
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';

jest.mock('../src/api/env', () => ({ getEnv: () => { throw new Error('NO_NETWORK_KEYS'); } }));
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
const issuedAtMs = 1791792000000;
function fixture() {
    const f = savedJourneyProviderFixture();
    Object.assign(f.route, { id: 'saved-map-fixture', mode: 'TRANSIT' });
    const value: WalkingSnapshot = { snapshotId: '12345678-1234-1234-1234-123456789abc', memberId: 7, loginGeneration: 0,
        scheduleId: 9001, routeRevision: 4, routeFingerprint: 'b'.repeat(64), issuedAtMs,
        expiresAtMs: issuedAtMs + 300000, navigationExpiresAtMs: issuedAtMs + 900000, navigationReady: false,
        walks: [0, 2].map(legIndex => { const leg = f.input.legs[legIndex]; return { legIndex, provider: 'tmap',
            points: [leg.start!, { latitude: leg.start!.latitude + .0001,
                longitude: (leg.start!.longitude + leg.end!.longitude) / 2 }, leg.end!]
                .map(point => ({ lat: point.latitude, lng: point.longitude })) }; }) };
    const input = composeServerWalkingInput(f.input, value, issuedAtMs + 10000);
    const binding = { sessionId: 'x', scheduleId: '9001', generation: 1, routeRevision: 4, routeInputDigest: 'a'.repeat(64),
        authMemberId: 7, loginGeneration: 0, syncScope: 'AUTHENTICATED', savedRouteValidated: true, guidanceEnabled: true,
        preparedAtEpochSeconds: issuedAtMs / 1000 + 10, expiresAtEpochSeconds: issuedAtMs / 1000 + 610 } as AutomaticJourneyBinding;
    const at = (seconds: number) => ({ enabled: true, status: 'ACTIVE', sessionId: binding.sessionId, routeRevision: 4,
        guidance: { ...binding, schemaVersion: 1, status: 'ACTIVE', sequence: 1, phase: 'WALKING_TO_STOP', quality: 'GOOD',
            boardingConfirmed: false, activeLegIndex: 0, walkProgress: .2, observedAt: seconds, validUntil: seconds + 15 } } as unknown as AutomaticJourneySnapshot);
    return { ...f, input, binding, at, now: issuedAtMs / 1000 + 30 };
}
test('copies separate server paths, keeps immutable saved claims and survives only the admitted v3 lifetime', () => {
    const f = fixture(), original = JSON.stringify(f.input);
    const paths = presentSavedJourneyWalkingMap(f.at(f.now), f.binding, f.input, f.now);
    expect(paths.map(path => path.legIndex)).toEqual([0, 2]);
    expect(paths[0].coordinates[1].latitude).toBe(37.5666);
    paths[0].coordinates[1].latitude = 0;
    expect(JSON.stringify(f.input)).toBe(original);
    const later = issuedAtMs / 1000 + 400;
    expect(presentSavedJourneyWalkingMap(f.at(later), f.binding, f.input, later)).toHaveLength(2);
    expect(presentSavedJourneyWalkingMap(f.at(later), f.binding, f.input, f.binding.expiresAtEpochSeconds)).toEqual([]);
});
test('v4 static geometry survives 10 minutes only for the same admitted session and stops at its two-hour deadline',()=>{
    const f=fixture();
    const wire=f.input.walkingSnapshot!;
    wire.schemaVersion=4;wire.navigationExpiresAtMs=issuedAtMs+7500000;
    f.binding.expiresAtEpochSeconds=f.binding.preparedAtEpochSeconds+7200;
    const later=f.binding.preparedAtEpochSeconds+3600;
    expect(presentSavedJourneyWalkingMap(f.at(later),f.binding,f.input,later)).toHaveLength(2);
    expect(presentSavedJourneyWalkingMap(f.at(later),f.binding,f.input,f.binding.expiresAtEpochSeconds)).toEqual([]);
    wire.schemaVersion=3;
    expect(presentSavedJourneyWalkingMap(f.at(later),f.binding,f.input,later)).toEqual([]);
});
test.each(['owner', 'login', 'schedule', 'revision', 'generation', 'stopped', 'late-admission', 'bad-point', 'disconnected', 'local-only', 'no-input'])
('does not display a path across %s boundaries', mode => {
    const f = fixture(), binding = { ...f.binding }, input = JSON.parse(JSON.stringify(f.input)), snapshot = f.at(f.now);
    if (mode === 'owner') binding.authMemberId = 8;
    if (mode === 'login') binding.loginGeneration = 1;
    if (mode === 'schedule') binding.scheduleId = '9002';
    if (mode === 'revision') input.routeRevision++;
    if (mode === 'generation') binding.generation++;
    if (mode === 'stopped') snapshot.status = 'STOPPED';
    if (mode === 'late-admission') { binding.preparedAtEpochSeconds = issuedAtMs / 1000 + 300; }
    if (mode === 'bad-point') input.walkingSnapshot.walks[0].points[0].lat = NaN;
    if (mode === 'disconnected') input.walkingSnapshot.walks[0].points[0].lng += .001;
    if (mode === 'local-only') binding.syncScope = 'LOCAL_ONLY';
    expect(presentSavedJourneyWalkingMap(snapshot, binding, mode === 'no-input' ? null : input, f.now)).toEqual([]);
});
test('static admitted geometry remains while GPS is stale; it does not create a position or extend lifetime', () => {
    const f = fixture(), snapshot = f.at(f.now);
    snapshot.guidance!.validUntil = f.now - 1;
    expect(presentSavedJourneyWalkingMap(snapshot, f.binding, f.input, f.now)).toHaveLength(2);
});
test('the map replaces walking geometry only, preserves bus overlays, fits and focuses adopted coordinates', () => {
    const f = fixture(), original = JSON.stringify(f.route);
    const paths = presentSavedJourneyWalkingMap(f.at(f.now), f.binding, f.input, f.now);
    const walking = new Map(paths.map(path => [path.legIndex, path.coordinates]));
    const options = { route: f.route, origin: f.origin, destination: f.destination, mapZoom: 15, isDark: false };
    const before = buildSavedRouteMapPresentation(options);
    const after = buildSavedRouteMapPresentation({ ...options, guidanceWalkingPaths: walking });
    expect(after.pathOverlays.filter(path => path.id.startsWith('guidance-server-walk-'))).toHaveLength(2);
    expect(after.pathOverlays.find(path => path.id === 'guidance-server-walk-0')?.coords).toEqual(paths[0].coordinates);
    expect(after.pathOverlays.filter(path => !path.id.startsWith('guidance-server-walk-')))
        .toEqual(before.pathOverlays.filter(path => !path.id.includes('walk') && !path.id.endsWith('-0') && !path.id.endsWith('-2')));
    expect(getSavedRouteFitCoords(f.route, f.origin, f.destination, walking)).toContainEqual(paths[0].coordinates[1]);
    const focused = buildSavedRouteMapPresentation({ ...options, focusedLegIndex: 0, guidanceWalkingPaths: walking });
    expect(focused.pathOverlays.find(path => path.id === 'guidance-server-walk-0')?.coords).toEqual(paths[0].coordinates);
    expect(focused.pathOverlays.filter(path => path.id.includes('focus'))).toHaveLength(0); // WALK has one line, camera-only focus.
    expect(after.routeLegs).toEqual(before.routeLegs);
    expect(JSON.stringify(f.route)).toBe(original);
    const preview = buildGuidancePreviewSVG(f.input, null, paths);
    expect(preview?.match(/polyline/g)).toHaveLength(3);
    expect(preview).not.toEqual(buildGuidancePreviewSVG(f.input, null));
    expect(buildGuidancePreviewSVG(f.input, null, [{ legIndex: 1, coordinates: paths[0].coordinates }])).toBeNull();
});
