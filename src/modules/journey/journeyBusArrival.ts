import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from "./automaticJourney";

export type JourneyBusArrivalQuery = { namespace: "SEOUL_BUS"; arsId: string; providerRouteId: string; directionLabel: string; legIndex: number };
export type JourneyBusArrivalView = { status: string; remainingSeconds: number | null; incomingVehicleId: string | null; confirmedBoarding: false };
const unavailable = (status: string): JourneyBusArrivalView => ({ status, remainingSeconds: null, incomingVehicleId: null, confirmedBoarding: false });
const record = (v: unknown): Record<string, unknown> | null => v != null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const instant = (v: unknown): number | null => {
    if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v)) return null;
    const value = Date.parse(v);
    return Number.isFinite(value) ? value : null;
};
export function busArrivalEligible(snapshot: AutomaticJourneySnapshot | null, binding: AutomaticJourneyBinding | null, now: number): boolean {
    return !!snapshot?.enabled && !!binding && snapshot.sessionId === binding.sessionId && snapshot.routeRevision === binding.routeRevision
        && binding.syncScope === "SANDBOX" && snapshot.syncScope === "SANDBOX" && binding.expiresAtEpochSeconds * 1000 > now
        && binding.preparedAtEpochSeconds * 1000 <= now && ["ARMED", "ACTIVE"].includes(snapshot.status)
        && snapshot.busQuality === "GOOD" && ["APPROACHING_STOP", "WAITING"].includes(snapshot.busPhase ?? "");
}

/** Strict response fence plus original source expiry. UI receipt time can never refresh an ETA. */
export function projectJourneyBusArrival(raw: unknown, binding: AutomaticJourneyBinding, query: JourneyBusArrivalQuery, now: number): JourneyBusArrivalView {
    const envelope = record(raw);
    const data = envelope?.success === true ? record(envelope.data) : null;
    const q = record(data?.query);
    if (!data || data.schemaVersion !== 1 || data.sessionId !== binding.sessionId || data.generation !== binding.generation
        || data.routeRevision !== binding.routeRevision || data.routeInputDigest !== binding.routeInputDigest
        || !q || Object.keys(query).some(key => q[key] !== query[key as keyof JourneyBusArrivalQuery])
        || data.confirmedBoarding !== false || data.identityEvidence !== "SAVED_ROUTE_METADATA" || data.remainingStopsToAlight !== null) return unavailable("RESPONSE_REJECTED");
    if (data.status !== "WAITING_INFORMATION") return unavailable(["NO_ARRIVAL", "IDENTITY_MISMATCH", "STALE", "UNVERIFIED", "INVALID", "UNAVAILABLE",
        "BINDING_RESPONSE_REJECTED", "SAVED_ROUTE_MAPPING_UNAVAILABLE", "SELECTED_SAVED_ROUTE_MISMATCH"].includes(String(data.status)) ? String(data.status) : "RESPONSE_REJECTED");
    const observation = record(data.observation);
    const source = instant(observation?.sourceUpdatedAt), receipt = instant(observation?.receivedAt);
    const expected = instant(observation?.expectedAt), expiry = instant(observation?.validUntil), evaluated = instant(data.evaluatedAt);
    if (!observation || observation.quality !== "FRESH_WAITING_INFORMATION" || observation.provider !== "SEOUL_BUS" || observation.kind !== "BUS"
        || observation.inputFreshnessEvidence !== "PROVIDER_SOURCE_TIMESTAMP" || observation.arsId !== query.arsId
        || observation.directionLabel !== query.directionLabel || observation.confirmedBoarding !== false
        || source == null || receipt == null || expected == null || expiry == null || evaluated == null
        || source > receipt + 5000 || receipt > evaluated + 5000 || source > evaluated + 5000 || evaluated > now + 5000
        || expected <= source || expected > source + 3600000 || expiry !== Math.min(source + 120000, expected)) return unavailable("RESPONSE_REJECTED");
    if (now >= expiry || now >= expected) return unavailable("STALE");
    const vehicle = typeof data.incomingVehicleId === "string" && /^[1-9]\d{0,19}$/.test(data.incomingVehicleId) ? data.incomingVehicleId : null;
    return { status: "WAITING_INFORMATION", remainingSeconds: Math.ceil((expected - now) / 1000), incomingVehicleId: vehicle, confirmedBoarding: false };
}

/** Single-flight poller. invalidate() cancels eligibility, not only the network request. */
export class JourneyBusArrivalPoller {
    private revision = 0;
    private busy = false;
    private raw: unknown = null;
    private nextAt = 0;
    invalidate() { this.revision++; this.raw = null; this.nextAt = 0; }
    async read(binding: AutomaticJourneyBinding, query: JourneyBusArrivalQuery, now: number,
        request: () => Promise<unknown>, stillCurrent: () => boolean): Promise<JourneyBusArrivalView> {
        if (!stillCurrent()) { this.invalidate(); return unavailable("LOCATION_OR_SESSION_UNAVAILABLE"); }
        if (!this.busy && now >= this.nextAt) {
            this.busy = true;
            const revision = this.revision;
            this.nextAt = now + 10000;
            try {
                const value = await request();
                if (revision === this.revision && stillCurrent()) this.raw = value;
            } catch { if (revision === this.revision) this.raw = null; }
            finally { this.busy = false; }
        }
        if (!stillCurrent()) { this.invalidate(); return unavailable("LOCATION_OR_SESSION_UNAVAILABLE"); }
        return this.raw == null ? unavailable("ARRIVAL_UNAVAILABLE") : projectJourneyBusArrival(this.raw, binding, query, Date.now());
    }
}
