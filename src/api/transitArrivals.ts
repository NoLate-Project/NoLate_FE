import { apiGet } from "./api";
import type { ApiEnvelope } from "./response";
import { unwrapApiResponse } from "./response";

export type TransitArrivalInfo = {
    provider: string;
    kind: "SUBWAY" | "BUS" | string;
    lineName?: string | null;
    routeName?: string | null;
    stationName?: string | null;
    direction?: string | null;
    destinationName?: string | null;
    arrivalMessage?: string | null;
    waitSeconds?: number | null;
    waitMinutes?: number | null;
    expectedAt?: string | null;
    lastTrain?: boolean;
    realtime?: boolean;
    arrivalStatus?: "APPROACHING" | "ARRIVED" | "DEPARTED" | "PREVIOUS_STOP" | "IN_TRANSIT" | "UNKNOWN" | string;
    arrivalStatusLabel?: string | null;
    observedAt?: string | null;
    sourceUpdatedAt?: string | null;
    remainingStops?: number | null;
    vehicleType?: string | null;
    lowFloor?: boolean | null;
    express?: boolean | null;
};

export async function getSubwayArrivals(params: {
    stationName: string;
    lineName?: string;
    directionName?: string;
    directionCode?: "UP" | "DOWN";
    limit?: number;
}): Promise<TransitArrivalInfo[]> {
    const response = await apiGet<ApiEnvelope<TransitArrivalInfo[]>>("/api/transit-arrivals/subway", {
        params,
    });
    return unwrapApiResponse(response);
}

export async function getBusArrivals(params: {
    arsId?: string;
    cityCode?: string;
    nodeId?: string;
    stationName?: string;
    routeName?: string;
    limit?: number;
}): Promise<TransitArrivalInfo[]> {
    const response = await apiGet<ApiEnvelope<TransitArrivalInfo[]>>("/api/transit-arrivals/bus", {
        params,
    });
    return unwrapApiResponse(response);
}
