import { automaticRecord, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from './automaticJourney';
import type { AutomaticJourneyRerouteFix } from './automaticJourneyTransport';
import type { JourneyRouteCoordinate, JourneyRouteInput } from './journeyRouteInput';

const METERS_PER_DEGREE = 111_195;
const REROUTE_ROUTE_CLEARANCE_METERS = 45;

function coordinate(value: unknown): JourneyRouteCoordinate | null {
    const point = automaticRecord(value);
    return point && typeof point.latitude === 'number' && Number.isFinite(point.latitude)
        && Math.abs(point.latitude) <= 90 && typeof point.longitude === 'number'
        && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
        ? { latitude: point.latitude, longitude: point.longitude } : null;
}

function distanceToSegment(point: AutomaticJourneyRerouteFix,
    start: JourneyRouteCoordinate, end: JourneyRouteCoordinate): number {
    const longitudeScale = METERS_PER_DEGREE * Math.cos(point.latitude * Math.PI / 180);
    const ax = (start.longitude - point.longitude) * longitudeScale;
    const ay = (start.latitude - point.latitude) * METERS_PER_DEGREE;
    const bx = (end.longitude - point.longitude) * longitudeScale;
    const by = (end.latitude - point.latitude) * METERS_PER_DEGREE;
    const dx = bx - ax, dy = by - ay;
    const fraction = dx * dx + dy * dy > 0
        ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(ax + fraction * dx, ay + fraction * dy);
}

/** A native off-route sample at a boarding stop or a just-committed origin is not a new detour. */
export function beyondAdmittedRoute(fix: AutomaticJourneyRerouteFix, route: JourneyRouteInput): boolean {
    if (!Array.isArray(route.legs) || route.legs.length === 0) return true;
    let checked = false;
    const near = (raw: unknown[]) => {
        const points = raw.map(coordinate).filter((point): point is JourneyRouteCoordinate => point !== null);
        if (!points.length) return false;
        checked = true;
        if (points.length === 1) return distanceToSegment(fix, points[0], points[0]) <= REROUTE_ROUTE_CLEARANCE_METERS;
        return points.slice(1).some((point, index) =>
            distanceToSegment(fix, points[index], point) <= REROUTE_ROUTE_CLEARANCE_METERS);
    };
    for (const leg of route.legs) {
        if (near(Array.isArray(leg.coordinates) ? leg.coordinates : [])) return false;
        if (near([leg.start]) || near([leg.end])) return false;
    }
    for (const walk of route.walkingSnapshot?.walks ?? []) {
        if (Array.isArray(walk.points) && near(walk.points.map(point => ({ latitude: point.lat, longitude: point.lng })))) return false;
    }
    return checked;
}

/** The raw device point is eligible for display/search only; it is never route progress. */
export function trustedOffRouteFix(snapshot: AutomaticJourneySnapshot | null,
    binding: AutomaticJourneyBinding | null, now: number): AutomaticJourneyRerouteFix | null {
    const fix = automaticRecord(snapshot?.deviceMapLocation);
    if (!binding || binding.savedRouteValidated !== true || binding.guidanceEnabled !== true
        || !snapshot?.enabled || snapshot.status !== 'ACTIVE' || snapshot.sessionId !== binding.sessionId
        || snapshot.routeRevision !== binding.routeRevision
        || (snapshot.qualityReason !== 'OFF_ROUTE' && snapshot.busReason !== 'BUS_OFF_ROUTE')
        || snapshot.ridePhase === 'RIDING' || snapshot.subwayPhase === 'RIDING'
        || !fix || fix.schemaVersion !== 1 || fix.sessionId !== binding.sessionId
        || fix.generation !== binding.generation || fix.routeRevision !== binding.routeRevision
        || fix.routeInputDigest !== binding.routeInputDigest
        || typeof fix.latitude !== 'number' || !Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90
        || typeof fix.longitude !== 'number' || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180
        || typeof fix.accuracyMeters !== 'number' || !Number.isFinite(fix.accuracyMeters)
        || fix.accuracyMeters < 0 || fix.accuracyMeters > 25
        || typeof fix.observedAt !== 'number' || !Number.isFinite(fix.observedAt)
        || fix.observedAt < binding.preparedAtEpochSeconds || fix.observedAt >= binding.expiresAtEpochSeconds
        || typeof fix.validUntil !== 'number' || !Number.isFinite(fix.validUntil)
        || fix.validUntil > Math.min(fix.observedAt + 15, binding.expiresAtEpochSeconds) + 0.001
        || !Number.isFinite(now) || fix.observedAt > now + 2 || now - fix.observedAt > 15
        || now >= fix.validUntil) return null;
    return { latitude: fix.latitude, longitude: fix.longitude,
        accuracyMeters: fix.accuracyMeters, observedAt: fix.observedAt };
}
