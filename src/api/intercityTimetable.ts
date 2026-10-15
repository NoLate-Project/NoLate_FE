import { apiGet } from "./api";
import { unwrapApiResponse, type ApiEnvelope } from "./response";

export type IntercityKind = "TRAIN" | "EXPRESS_BUS" | "INTERCITY_BUS";
export type TimetableStatus = "AVAILABLE" | "NO_SERVICES" | "DATE_UNSUPPORTED" | "KEY_MISSING" | "ACCESS_DENIED" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
export type IntercityCity = { code: string; name: string };
export type IntercityStop = { id: string; name: string; cityName?: string | null };
export type IntercityService = {
    id: string; kind: IntercityKind; departureId: string; arrivalId: string;
    departureName: string; arrivalName: string; departureAt: string; arrivalAt: string;
    serviceDate: string; grade?: string | null; trainNumber?: string | null; fare?: number | null;
    timingBasis: "TIMETABLE"; bookingStatus: "UNCONFIRMED";
};
export type TimetablePage<T> = {
    status: TimetableStatus; items: T[]; page: number; hasMore: boolean;
    fetchedAt?: string | null; message?: string | null; source: "TAGO";
};

async function get<T>(path: string, params: Record<string, string | number | undefined>) {
    return unwrapApiResponse(await apiGet<ApiEnvelope<TimetablePage<T>>>(`/api/intercity/${path}`, { params }));
}
export const getIntercityCities = (kind: IntercityKind) => get<IntercityCity>("cities", { kind });
export const getIntercityStops = (params: { kind: IntercityKind; cityCode?: string; query?: string; page?: number }) => get<IntercityStop>("stops", params);
export const getIntercityServices = (params: { kind: IntercityKind; departureId: string; arrivalId: string; date: string; page?: number }) => get<IntercityService>("services", params);
