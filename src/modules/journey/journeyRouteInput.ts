/** P1-2 wire contract. No map overlay, start/end connector, or display stop fallback is used. */
export type JourneyRouteContextName = "ROUTING_RESPONSE" | "SAVED_ROUTE" | "SYNTHETIC_FIXTURE";
export type JourneyRouteCoordinate = { latitude: number; longitude: number };
export type JourneyRouteStopInput = {
    sourceIndex: number;
    providerSequence: number | null;
    name: string | null;
    code: string | null;
    coordinate: JourneyRouteCoordinate | null;
    /** Raw ODsay subway namespace only. Not a Seoul station ID or passenger evidence. */
    routingStationId?: string | null;
};
export type JourneyRouteLegInput = {
    index: number;
    kind: "WALK" | "BUS" | "SUBWAY" | "ETC" | "UNKNOWN";
    geometrySource: string;
    exact: boolean;
    geometryInputComplete: boolean;
    coordinates: (JourneyRouteCoordinate | null)[];
    start: JourneyRouteCoordinate | null;
    end: JourneyRouteCoordinate | null;
    providerRouteId: string | null;
    localRouteId: string | null;
    directionName: string | null;
    directionCode: string | null;
    serviceAvailable: boolean | null;
    declaredStationCount: number | null;
    stopEvidenceProvider: string | null;
    stopEvidenceVersion: number | null;
    stops: JourneyRouteStopInput[];
    /** Immutable provider display claims; never navigation/vehicle evidence. Absent on legacy v1. */
    display?: { lineName: string | null; lineColor: string | null; durationMinutes: number | null; distanceMeters: number | null };
};
export type JourneyRouteInput = {
    /** Separately owned server contract. Never changes any saved provider geometry/evidence. */
    walkingSnapshot?: import('./serverWalkingSnapshot').WalkingSnapshotWire;
    schemaVersion: 1;
    routeRevision: number;
    context: JourneyRouteContextName;
    provider: "tmap" | "odsay" | "UNKNOWN";
    source: "api" | "fallback" | "UNKNOWN";
    reliability: "live_provider" | "provider_estimate" | "fallback_estimate" | "UNKNOWN";
    plausibility: "normal" | "geometry_suspected" | "UNKNOWN";
    serviceState: "operating" | "not_operating" | "UNKNOWN";
    origin: JourneyRouteCoordinate | null;
    destination: JourneyRouteCoordinate | null;
    legs: JourneyRouteLegInput[];
};
export type JourneyRouteInputContext = {
    routeRevision: number;
    context: JourneyRouteContextName;
    /** Independently selected endpoints, not copied from a leg or display polyline. */
    origin: unknown;
    destination: unknown;
};
export type JourneyRouteInputBuildResult =
    | { ok: true; input: JourneyRouteInput }
    | { ok: false; reason: "INVALID_ROUTE_INPUT" | "INPUT_LIMIT_EXCEEDED" | "TRANSIT_ROUTE_REQUIRED" };

export const JOURNEY_ROUTE_INPUT_LIMITS = {
    jsonBytes: 1_048_576, legs: 32, pointsPerLeg: 2000, totalPoints: 12000,
    stopsPerLeg: 500, totalStops: 2000, stringBytes: 256,
} as const;

export function journeyRouteUTF8Bytes(value: string): number {
    let bytes = 0;
    for (const character of value) {
        const point = character.codePointAt(0)!;
        bytes += point <= 0x7F ? 1 : point <= 0x7FF ? 2 : point <= 0xFFFF ? 3 : 4;
    }
    return bytes;
}

const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export const journeyDisplayNumber = (value: unknown, maximum: number): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum ? value : null;
export function journeyDisplayName(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 64 || journeyRouteUTF8Bytes(value.trim()) > 256
        || Array.from(value).some(c => { const n = c.codePointAt(0)!; return n <= 31 || n >= 127 && n <= 159; })) return null;
    return value.trim();
}
export function journeyDisplayColor(value: unknown): string | null {
    return typeof value === 'string' && value.length === (value.startsWith('#') ? 7 : 6)
        && /^#?[0-9a-fA-F]{6}$/.test(value) ? `#${value.replace('#', '').toUpperCase()}` : null;
}
const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;

function text(value: unknown): string | null {
    if (typeof value !== "string") return null;
    if (value.length > JOURNEY_ROUTE_INPUT_LIMITS.stringBytes
        || journeyRouteUTF8Bytes(value) > JOURNEY_ROUTE_INPUT_LIMITS.stringBytes) throw new RangeError();
    const containsControl = Array.from(value).some(character => {
        const point = character.codePointAt(0)!;
        return point <= 0x1F || point === 0x7F;
    });
    return value.trim() && !containsControl ? value.trim() : null;
}

function coordinate(value: unknown): JourneyRouteCoordinate | null {
    const candidate = record(value);
    if (!candidate || typeof candidate.lat !== "number" || typeof candidate.lng !== "number"
        || !Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return null;
    // Preserve out-of-range finite values for native rejection; never repair/swap coordinates.
    return { latitude: candidate.lat, longitude: candidate.lng };
}

/**
 * Accepts the existing RouteAlternativeOption/TransitRouteOption shape, including saved unknown JSON.
 * It copies only a bounded allow-list. It does not assess readiness, call APIs, or start a journey.
 * Provider claims remain claims. A legacy display passStops list cannot create navigation evidence.
 */
export function buildJourneyRouteInput(route: unknown, context: JourneyRouteInputContext): JourneyRouteInputBuildResult {
    try {
        const root = record(route);
        if (!root || !context || integer(context.routeRevision) === null || context.routeRevision < 1
            || !["ROUTING_RESPONSE", "SAVED_ROUTE", "SYNTHETIC_FIXTURE"].includes(context.context)) {
            return { ok: false, reason: "INVALID_ROUTE_INPUT" };
        }
        if (root.mode !== undefined && root.mode !== "TRANSIT") return { ok: false, reason: "TRANSIT_ROUTE_REQUIRED" };
        if (!Array.isArray(root.transitLegs) || root.transitLegs.length === 0) return { ok: false, reason: "INVALID_ROUTE_INPUT" };
        if (root.transitLegs.length > JOURNEY_ROUTE_INPUT_LIMITS.legs) throw new RangeError();
        let pointCount = 0;
        let stopCount = 0;
        const legs = Array.from(root.transitLegs, (value, index): JourneyRouteLegInput => {
            const leg = record(value);
            if (!leg) throw new TypeError();
            const path = Array.isArray(leg.pathCoords) ? leg.pathCoords : [];
            const evidence = record(leg.navigationEvidence);
            const stops = Array.isArray(evidence?.stopOccurrences) ? evidence.stopOccurrences : [];
            pointCount += path.length;
            stopCount += stops.length;
            if (path.length > JOURNEY_ROUTE_INPUT_LIMITS.pointsPerLeg || pointCount > JOURNEY_ROUTE_INPUT_LIMITS.totalPoints
                || stops.length > JOURNEY_ROUTE_INPUT_LIMITS.stopsPerLeg || stopCount > JOURNEY_ROUTE_INPUT_LIMITS.totalStops) throw new RangeError();
            return {
                index,
                kind: choice(leg.kind, ["WALK", "BUS", "SUBWAY", "ETC", "UNKNOWN"] as const, "UNKNOWN"),
                geometrySource: text(leg.pathGeometrySource) ?? "UNKNOWN",
                exact: leg.pathCoordsIsExact === true,
                geometryInputComplete: evidence?.geometryInputComplete === true,
                coordinates: Array.from(path, coordinate),
                start: coordinate(leg.startCoord), end: coordinate(leg.endCoord),
                providerRouteId: text(leg.providerRouteId), localRouteId: text(leg.localRouteId),
                // Do not promote display-derived direction names or inferred station counts.
                directionName: text(evidence?.directionName),
                directionCode: text(evidence?.directionCode),
                serviceAvailable: typeof leg.serviceAvailable === "boolean" ? leg.serviceAvailable : null,
                declaredStationCount: integer(evidence?.declaredStationCount),
                stopEvidenceProvider: text(evidence?.provider), stopEvidenceVersion: integer(evidence?.version),
                stops: Array.from(stops, stopValue => {
                    const stop = record(stopValue);
                    return {
                        sourceIndex: integer(stop?.sourceIndex) ?? -1,
                        providerSequence: integer(stop?.providerSequence),
                        name: text(stop?.name), code: text(stop?.code), coordinate: coordinate(stop?.coord),
                        ...(leg.kind === 'SUBWAY' && text(stop?.routingStationID)
                            ? { routingStationId: text(stop?.routingStationID) } : {}),
                    };
                }),
                display: {
                    lineName: ['BUS', 'SUBWAY'].includes(String(leg.kind)) ? journeyDisplayName(leg.lineName) : null,
                    lineColor: ['BUS', 'SUBWAY'].includes(String(leg.kind)) ? journeyDisplayColor(leg.lineColor) : null,
                    durationMinutes: journeyDisplayNumber(leg.durationMinutes, 1440),
                    distanceMeters: journeyDisplayNumber(leg.distanceMeters, 10_000_000),
                },
            };
        });
        const input: JourneyRouteInput = {
            schemaVersion: 1, routeRevision: context.routeRevision, context: context.context,
            provider: choice(root.provider, ["tmap", "odsay", "UNKNOWN"] as const, "UNKNOWN"),
            source: choice(root.source, ["api", "fallback", "UNKNOWN"] as const, "UNKNOWN"),
            reliability: choice(root.routeReliability, ["live_provider", "provider_estimate", "fallback_estimate", "UNKNOWN"] as const, "UNKNOWN"),
            plausibility: choice(root.routePlausibility, ["normal", "geometry_suspected", "UNKNOWN"] as const, "UNKNOWN"),
            serviceState: choice(root.transitServiceState, ["operating", "not_operating", "UNKNOWN"] as const, "UNKNOWN"),
            origin: coordinate(context.origin), destination: coordinate(context.destination), legs,
        };
        if (journeyRouteUTF8Bytes(JSON.stringify(input)) > JOURNEY_ROUTE_INPUT_LIMITS.jsonBytes) throw new RangeError();
        return { ok: true, input };
    } catch (error) {
        return { ok: false, reason: error instanceof RangeError ? "INPUT_LIMIT_EXCEEDED" : "INVALID_ROUTE_INPUT" };
    }
}
