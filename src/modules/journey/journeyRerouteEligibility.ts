import { automaticRecord, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from './automaticJourney';
import type { AutomaticJourneyRerouteFix } from './automaticJourneyTransport';

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
