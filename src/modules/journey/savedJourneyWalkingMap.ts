import { automaticRecord, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from './automaticJourney';
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
        const route = automaticRecord(snapshot?.guidanceRoute);
        const rawLegs = route?.legs;
        const matches = route && ['sessionId', 'scheduleId', 'generation', 'routeRevision', 'routeInputDigest']
            .every(key => route[key] === binding[key as keyof AutomaticJourneyBinding]) && Array.isArray(rawLegs)
            && rawLegs.length === admittedInput.legs.length && rawLegs.every((raw, i) => {
                const metadata = automaticRecord(raw);
                return metadata?.index === i && metadata?.kind === admittedInput.legs[i].kind;
            });
        return parsed.walks.map(walk => {
            const index = walk.legIndex;
            const saved = admittedInput.legs[index];
            const original = saved.coordinates;
            const insideStation = matches && automaticRecord(rawLegs[index])?.walkingGeometrySource === 'ODSAY_TRANSFER'
                && saved.kind === 'WALK' && saved.exact && saved.geometryInputComplete
                && saved.geometrySource === 'WALK_STEPS_LINESTRING' && original.length >= 2
                && admittedInput.legs[index - 1]?.kind === 'SUBWAY' && admittedInput.legs[index + 1]?.kind === 'SUBWAY'
                && original.every((p): p is JourneyRouteCoordinate => !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
            return { legIndex: index, coordinates: insideStation
                ? original.map(point => ({ ...point }))
                : walk.points.map(point => ({ latitude: point.lat, longitude: point.lng })) };
        });
    } catch { return []; }
}
