import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from './automaticJourney';
import type { JourneyRouteCoordinate, JourneyRouteInput } from './journeyRouteInput';
import { presentSavedJourneyGuidance } from './savedJourneyGuidance';
import { composeServerWalkingInput, parseWalkingSnapshot } from './serverWalkingSnapshot';

export type SavedJourneyWalkingMapPath = { legIndex: number; coordinates: JourneyRouteCoordinate[] };

/** Display-only geometry from the exact in-memory armed input. Never changes saved ODsay claims. */
export function presentSavedJourneyWalkingMap(snapshot: AutomaticJourneySnapshot | null,
    binding: AutomaticJourneyBinding | null, admittedInput: JourneyRouteInput | null,
    nowSeconds: number): SavedJourneyWalkingMapPath[] {
    const wire = admittedInput?.walkingSnapshot;
    if (!binding || !admittedInput || !wire || binding.syncScope !== 'AUTHENTICATED'
        || admittedInput.routeRevision !== binding.routeRevision
        || String(wire.scheduleId) !== binding.scheduleId || wire.routeRevision !== binding.routeRevision
        || wire.memberId !== binding.authMemberId || wire.loginGeneration !== binding.loginGeneration
        || !Number.isFinite(nowSeconds) || nowSeconds < binding.preparedAtEpochSeconds
        || !presentSavedJourneyGuidance(snapshot, binding, nowSeconds)) return [];
    try {
        // v3/v4 admission is not renewed: only an already-owned preparation admitted inside
        // the original five-minute window may display its separately bounded navigation path.
        const retained = wire.schemaVersion === 3 || wire.schemaVersion === 4;
        const validationMs = retained ? binding.preparedAtEpochSeconds * 1000 : nowSeconds * 1000;
        const deadlineMs = retained ? wire.navigationExpiresAtMs : wire.expiresAtMs;
        if (typeof deadlineMs !== 'number' || nowSeconds * 1000 >= deadlineMs
            || binding.expiresAtEpochSeconds * 1000 > deadlineMs) return [];
        const parsed = parseWalkingSnapshot(wire, wire,
            { authMemberId: binding.authMemberId!, loginGeneration: binding.loginGeneration! }, validationMs);
        composeServerWalkingInput(admittedInput, parsed, validationMs); // Endpoint/order/size checks, no persistence.
        return parsed.walks.map(walk => ({ legIndex: walk.legIndex,
            coordinates: walk.points.map(point => ({ latitude: point.lat, longitude: point.lng })) }));
    } catch { return []; }
}
