import type { AutomaticJourneyBinding } from "./automaticJourney";
import type { JourneyBusArrivalQuery } from "./journeyBusArrival";

export type JourneyBusRouteMapping = { status: string; query: JourneyBusArrivalQuery | null;
    boarding: { sourceIndex: number; providerSequence: number; localStationId: string; latitude: number; longitude: number } | null };
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const blocked = (status: string): JourneyBusRouteMapping => ({ status, query: null, boarding: null });
const ars = (v: unknown): string | null => typeof v === "string" && /^(?:\d{5}|\d{2}-\d{3})$/.test(v) && v.replace("-", "") !== "00000" ? v.replace("-", "") : null;
const id = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,19}$/.test(v);
const coord = (v: unknown) => { const c = record(v); return c && typeof c.lat === "number" && typeof c.lng === "number" && Number.isFinite(c.lat) && Number.isFinite(c.lng)
    && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180 ? { latitude: c.lat, longitude: c.lng } : null; };
const distance = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
    const r = Math.PI / 180, h = Math.sin((b.latitude - a.latitude) * r / 2) ** 2
        + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin((b.longitude - a.longitude) * r / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
};
/** Preview only. Server independently repeats this against the owned, unchanged saved route. */
export function resolveJourneyBusRouteMapping(value: unknown, busLegIndex=1): JourneyBusRouteMapping {
    return resolve(value, busLegIndex, false);
}

/** Local raw-evidence preflight only. Missing ODsay way/count still need official SERVER proof. */
export function resolveJourneyBusOfficialCrosswalkInput(value: unknown, busLegIndex=1): JourneyBusRouteMapping {
    return resolve(value, busLegIndex, true);
}

function resolve(value: unknown, busLegIndex: number, allowMissingOfficialClaims: boolean): JourneyBusRouteMapping {
    const root = record(value), info = record(root?.routeInfo);
    const candidates = [root?.transitLegs, info?.transitLegs, record(root?.transitJourney)?.legs,
        record(root?.selectedItinerary)?.legs, record(root?.itinerary)?.legs, root?.legs].filter(v => Array.isArray(v) && v.length > 0);
    if (candidates.length !== 1) return blocked("AMBIGUOUS_ROUTE_SNAPSHOT");
    const container = Array.isArray(root?.transitLegs) ? root : info;
    if (root?.provider != null && container?.provider !== root.provider || root?.source != null && container?.source !== root.source) return blocked("AMBIGUOUS_ROUTE_SNAPSHOT");
    if (container?.provider !== "odsay" || container.source !== "api") return blocked("UNSUPPORTED_PROVIDER");
    const legs = candidates[0] as unknown[], leg = record(legs[busLegIndex]);
    if (!Number.isSafeInteger(busLegIndex)||busLegIndex<1||busLegIndex>29||busLegIndex%2!==1
        ||record(legs[0])?.kind !== "WALK" || record(legs[busLegIndex-1])?.kind !== 'WALK' || leg?.kind !== "BUS") return blocked("UNSUPPORTED_LEG");
    const provider = leg.routeProviderCode;
    if (leg.routeCityCode !== "1000" || (provider !== "4" && provider !== "10") || leg.startStationCityCode !== "1000" || leg.startStationProviderCode !== provider) return blocked("UNSUPPORTED_NAMESPACE");
    if (!id(leg.localRouteId)) return blocked("LOCAL_ROUTE_ID_REQUIRED");
    const stopArs = ars(leg.startArsID);
    if (!stopArs) return blocked("BOARDING_ARS_REQUIRED");
    if (!id(leg.startLocalStationID)) return blocked("LOCAL_STATION_ID_REQUIRED");
    const evidence = record(leg.navigationEvidence);
    if (evidence?.version !== 1 || evidence.provider !== "odsay") return blocked("RAW_STOP_EVIDENCE_REQUIRED");
    const rawIds = record(evidence.busIdentifiers);
    if (!rawIds || ["localRouteId", "routeCityCode", "routeProviderCode", "startLocalStationID", "startArsID", "startStationCityCode", "startStationProviderCode"]
        .some(key => typeof rawIds[key] !== "string" || rawIds[key] !== leg[key])) return blocked("RAW_BUS_IDENTIFIERS_REQUIRED");
    const direction = evidence.directionName;
    const missingDirection = direction == null;
    if ((!allowMissingOfficialClaims || !missingDirection) && (typeof direction !== "string" || !direction.trim() || direction.length > 128
        || Array.from(direction).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159))) return blocked("DIRECTION_REQUIRED");
    const stops = evidence.stopOccurrences;
    const missingCount = evidence.declaredStationCount == null;
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > 500
        || (!allowMissingOfficialClaims || !missingCount) && evidence.declaredStationCount !== stops.length - 1) return blocked("STOP_OCCURRENCE_REQUIRED");
    let previous = -1;
    for (const [index, raw] of stops.entries()) {
        const stop = record(raw), sequence = stop?.providerSequence;
        if (stop?.sourceIndex !== index || typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 0 || sequence > 2147483647 || sequence <= previous || !coord(stop.coord)
            || !id(stop.localStationID) || !ars(stop.arsID) || stop.stationCityCode !== "1000" || stop.stationProviderCode !== provider) return blocked("STOP_OCCURRENCE_REQUIRED");
        previous = sequence;
    }
    const first = record(stops[0])!;
    if (first.localStationID !== leg.startLocalStationID || ars(first.arsID) !== stopArs || first.stationCityCode !== "1000" || first.stationProviderCode !== provider) return blocked("BOARDING_OCCURRENCE_MISMATCH");
    if (stops.filter(raw => { const stop = record(raw); return stop?.localStationID === leg.startLocalStationID || ars(stop?.arsID) === stopArs; }).length !== 1) return blocked("AMBIGUOUS_BOARDING_OCCURRENCE");
    const position = coord(first.coord)!, start = coord(leg.startCoord);
    if (!start) return blocked("BOARDING_COORDINATE_REQUIRED");
    if (distance(position, start) > 30) return blocked("BOARDING_OCCURRENCE_MISMATCH");
    if (missingDirection || missingCount) return blocked("OFFICIAL_CROSSWALK_REQUIRED");
    return { status: "SUPPORTED", query: { namespace: "SEOUL_BUS", arsId: stopArs, providerRouteId: leg.localRouteId, directionLabel: direction, legIndex: busLegIndex },
        boarding: { sourceIndex: 0, providerSequence: first.providerSequence as number, localStationId: leg.startLocalStationID, ...position } };
}

/** Fence server mapping against both the active session and selected metadata before arrival polling. */
export function projectJourneyBusBinding(raw: unknown, binding: AutomaticJourneyBinding, selected: JourneyBusRouteMapping): JourneyBusRouteMapping {
    const envelope = record(raw), data = envelope?.success === true ? record(envelope.data) : null, mapping = record(data?.mapping);
    if (!data || data.schemaVersion !== 1 || data.identityEvidence !== "SAVED_ROUTE_METADATA" || data.sessionId !== binding.sessionId
        || data.generation !== binding.generation || data.routeRevision !== binding.routeRevision || data.routeInputDigest !== binding.routeInputDigest || !mapping) return blocked("BINDING_RESPONSE_REJECTED");
    if (selected.status !== "SUPPORTED") return blocked(selected.status);
    if (mapping.status !== "SUPPORTED") return blocked("SAVED_ROUTE_MAPPING_UNAVAILABLE");
    const query = record(mapping.query), boarding = record(mapping.boarding);
    if (!query || !boarding || !selected.query || !selected.boarding
        || Object.entries(selected.query).some(([key, v]) => query[key] !== v)
        || Object.entries(selected.boarding).some(([key, v]) => boarding[key] !== v)) return blocked("SELECTED_SAVED_ROUTE_MISMATCH");
    return selected;
}
