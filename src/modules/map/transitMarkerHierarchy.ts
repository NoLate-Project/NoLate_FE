export type TransitMarkerHierarchyCandidate = {
    intent: "BOARD" | "ALIGHT" | "TRANSFER";
    legIndex: number;
    stopName?: string;
    coord: {
        lat: number;
        lng: number;
    };
};

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_ADJACENT_LEG_GAP = 4;
const SAME_STATION_TRANSFER_MAX_METERS = 250;
const SAME_POINT_TRANSFER_MAX_METERS = 18;
const ENDPOINT_EVENT_MAX_METERS = 36;
const ENDPOINT_EVENT_COLLISION_MAX_METERS = 110;

export type TransitEndpointEventIntent = "board" | "alight" | "transfer";

function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

function distanceMeters(
    first: TransitMarkerHierarchyCandidate["coord"],
    second: TransitMarkerHierarchyCandidate["coord"]
): number {
    if (![first.lat, first.lng, second.lat, second.lng].every(Number.isFinite)) {
        return Number.POSITIVE_INFINITY;
    }

    const latDelta = toRadians(second.lat - first.lat);
    const lngDelta = toRadians(second.lng - first.lng);
    const firstLat = toRadians(first.lat);
    const secondLat = toRadians(second.lat);
    const haversine = (
        Math.sin(latDelta / 2) ** 2 +
        Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lngDelta / 2) ** 2
    );
    return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function getTransitStationIdentity(name?: string): string | undefined {
    const normalized = name
        ?.normalize("NFKC")
        .replace(/\([^)]*\)/gu, "")
        .replace(/(?:수도권)?\d+호선/gu, "")
        .replace(/지하철/gu, "")
        .replace(/[\s·.,]/gu, "")
        .replace(/(?:역|정류장)+$/u, "")
        .trim();
    return normalized || undefined;
}

export function isRedundantTransferAlight(
    alight: TransitMarkerHierarchyCandidate,
    transfer: TransitMarkerHierarchyCandidate
): boolean {
    if (alight.intent !== "ALIGHT" || transfer.intent !== "TRANSFER") return false;

    const legGap = transfer.legIndex - alight.legIndex;
    if (legGap <= 0 || legGap > MAX_ADJACENT_LEG_GAP) return false;

    const gapMeters = distanceMeters(alight.coord, transfer.coord);
    if (gapMeters <= SAME_POINT_TRANSFER_MAX_METERS) return true;

    const alightStation = getTransitStationIdentity(alight.stopName);
    const transferStation = getTransitStationIdentity(transfer.stopName);
    return !!(
        alightStation &&
        transferStation &&
        alightStation === transferStation &&
        gapMeters <= SAME_STATION_TRANSFER_MAX_METERS
    );
}

/**
 * The endpoint pin owns the first and last user action when both markers point
 * to the same place. Transfer markers are never removed by this rule.
 */
export function isRedundantEndpointTransitEvent(
    intent: TransitEndpointEventIntent | undefined,
    coord: TransitMarkerHierarchyCandidate["coord"],
    endpoints: {
        origin?: TransitMarkerHierarchyCandidate["coord"];
        destination?: TransitMarkerHierarchyCandidate["coord"];
    },
    mapZoom?: number
): boolean {
    const referenceLatitude = endpoints.origin?.lat ?? endpoints.destination?.lat ?? coord.lat;
    const metersPerPixel = typeof mapZoom === "number" && Number.isFinite(mapZoom)
        ? (156_543.03392 * Math.cos(toRadians(referenceLatitude))) / (2 ** mapZoom)
        : 0;
    const collisionThresholdMeters = Math.max(
        ENDPOINT_EVENT_MAX_METERS,
        Math.min(ENDPOINT_EVENT_COLLISION_MAX_METERS, metersPerPixel * 44)
    );
    if (intent === "board" && endpoints.origin) {
        return distanceMeters(coord, endpoints.origin) <= collisionThresholdMeters;
    }
    if (intent === "alight" && endpoints.destination) {
        return distanceMeters(coord, endpoints.destination) <= collisionThresholdMeters;
    }
    return false;
}

/**
 * A transfer is one user action even when the provider gives each platform a
 * slightly different coordinate. Keep the next boarding node and remove only
 * the immediately preceding alight badge; the dashed transfer path remains.
 */
export function collapseRedundantTransferAlights<T extends TransitMarkerHierarchyCandidate>(
    candidates: T[]
): T[] {
    const transfers = candidates.filter((candidate) => candidate.intent === "TRANSFER");
    if (!transfers.length) return candidates;

    return candidates.filter((candidate) => (
        candidate.intent !== "ALIGHT" ||
        !transfers.some((transfer) => isRedundantTransferAlight(candidate, transfer))
    ));
}
