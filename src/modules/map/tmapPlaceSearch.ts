import {
    nominatimClient,
    safeNumber,
    distanceBetweenCoordsMeters,
    pickFirstValidCoordinatePair,
    ensureArray,
    tmapClient,
    dedupePathCoords,
} from "./tmapApiCore.ts";
import type {
    PlaceSearchItem,
    RoutePathCoord,
    PlaceSearchContext,
    RouteGuideStep,
} from "./tmapApiCore.ts";

import {
    parseLatLngPair,
    normalizeRoadSegmentTimeToMinutes,
    normalizeInstruction,
} from "./tmapRoadResponse.ts";

/** 정규화된 경로 데이터를 조합해 `composeTmapAddress` 결과를 생성합니다. */
export function composeTmapAddress(poi: any): string {
    const newAddress = ensureArray(poi?.newAddressList?.newAddress)[0];
    const roadAddress = typeof newAddress?.fullAddressRoad === "string" ? newAddress.fullAddressRoad.trim() : "";
    if (roadAddress) return roadAddress;

    const jibunAddress = [
        poi?.upperAddrName,
        poi?.middleAddrName,
        poi?.lowerAddrName,
        poi?.detailAddrName,
        [poi?.firstNo, poi?.secondNo].filter(Boolean).join("-"),
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => (value as string).trim())
        .join(" ");

    return jibunAddress;
}

/** 공급자 원본 값을 `pickPoiSearchCoord` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function pickPoiSearchCoord(poi: any): RoutePathCoord | undefined {
    // 길찾기 입력에는 건물 중심점보다 실제로 접근 가능한 보행자/정문 좌표를 우선한다.
    return pickFirstValidCoordinatePair([
        [poi?.pnsLat, poi?.pnsLon],
        [poi?.frontLat, poi?.frontLon],
        [poi?.noorLat, poi?.noorLon],
        [poi?.newLat, poi?.newLon],
        [poi?.lat, poi?.lon],
    ]);
}

/** TMAP 경로 처리의 `applySearchDistance` 계산 단계를 독립적으로 수행합니다. */
export function applySearchDistance(
    item: PlaceSearchItem,
    context?: PlaceSearchContext
): PlaceSearchItem {
    if (!context?.center) return item;
    return {
        ...item,
        distanceMeters: Math.round(distanceBetweenCoordsMeters(context.center, { lat: item.lat, lng: item.lng })),
    };
}

/** 공급자 원본 값을 `parsePoiResults` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parsePoiResults(data: any, context?: PlaceSearchContext): PlaceSearchItem[] {
    const rawPoi = data?.searchPoiInfo?.pois?.poi;
    const poiList = ensureArray(rawPoi);

    return poiList
        .map((poi: any) => {
            const coord = pickPoiSearchCoord(poi);
            if (!coord) return null;

            const name = typeof poi?.name === "string" && poi.name.trim()
                ? poi.name.trim()
                : composeTmapAddress(poi);
            if (!name) return null;

            const address = composeTmapAddress(poi);
            const category = [
                poi?.upperBizName,
                poi?.middleBizName,
                poi?.lowerBizName,
                poi?.detailBizName,
            ]
                .filter((value) => typeof value === "string" && value.trim().length > 0)
                .map((value) => (value as string).trim())
                .join(" > ")
                || undefined;

            return applySearchDistance({
                name,
                address: address || name,
                lat: coord.lat,
                lng: coord.lng,
                category,
                provider: "tmap",
                providerPlaceId: poi?.id === undefined || poi?.id === null ? undefined : String(poi.id),
            } as PlaceSearchItem, context);
        })
        .filter((value: PlaceSearchItem | null): value is PlaceSearchItem => value !== null);
}

/** 공급자 원본 값을 `parseFullAddressGeoResults` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseFullAddressGeoResults(data: any, query: string, context?: PlaceSearchContext): PlaceSearchItem[] {
    const coordinates = ensureArray(data?.coordinateInfo?.coordinate);

    return coordinates
        .map((item: any, index: number) => {
            const lat = safeNumber(item?.newLat ?? item?.lat);
            const lng = safeNumber(item?.newLon ?? item?.lon);
            if (typeof lat !== "number" || typeof lng !== "number") return null;

            const address = (
                item?.newAddressList?.newAddress?.fullAddressRoad ??
                item?.fullAddress ??
                item?.newAddress ??
                item?.oldAddress
            ) as string | undefined;

            const name = (address && address.trim())
                ? address.trim().split(" ").slice(0, 3).join(" ")
                : `${query} ${index + 1}`;

            return applySearchDistance({
                name,
                address: address?.trim() || query,
                lat,
                lng,
                category: "주소",
                provider: "tmap",
            } as PlaceSearchItem, context);
        })
        .filter((value: PlaceSearchItem | null): value is PlaceSearchItem => value !== null);
}

/** 공급자 원본 값을 `dedupeSearchResults` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function dedupeSearchResults(items: PlaceSearchItem[]): PlaceSearchItem[] {
    const seen = new Set<string>();
    const result: PlaceSearchItem[] = [];

    items.forEach((item) => {
        const key = `${item.name}|${item.lat.toFixed(6)}|${item.lng.toFixed(6)}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push(item);
    });
    return result;
}

/** 지도 공급자 호출과 대체 경로를 조율해 `searchViaTmapPoi` 결과를 반환합니다. */
export async function searchViaTmapPoi(query: string, context?: PlaceSearchContext): Promise<PlaceSearchItem[]> {
    const client = tmapClient();
    const centerParams = context?.center
        ? {
            centerLat: String(context.center.lat),
            centerLon: String(context.center.lng),
            radius: String(Math.max(1, Math.min(33, context.radiusKm ?? 20))),
        }
        : {};
    const response = await client.get("/tmap/pois", {
        params: {
            version: 1,
            format: "json",
            count: 10,
            searchKeyword: query,
            reqCoordType: "WGS84GEO",
            resCoordType: "WGS84GEO",
            ...centerParams,
        },
    });
    return parsePoiResults(response.data, context);
}

/** TMAP 경로 처리의 `geocodeViaTmap` 계산 단계를 독립적으로 수행합니다. */
export async function geocodeViaTmap(query: string, context?: PlaceSearchContext): Promise<PlaceSearchItem[]> {
    const client = tmapClient();
    const response = await client.get("/tmap/geo/fullAddrGeo", {
        params: {
            version: 1,
            format: "json",
            coordType: "WGS84GEO",
            fullAddr: query,
        },
    });
    return parseFullAddressGeoResults(response.data, query, context);
}

/** 지도 공급자 호출과 대체 경로를 조율해 `reverseViaTmap` 결과를 반환합니다. */
export async function reverseViaTmap(lat: number, lng: number): Promise<string | undefined> {
    const client = tmapClient();
    const response = await client.get("/tmap/geo/reversegeocoding", {
        params: {
            version: 1,
            format: "json",
            coordType: "WGS84GEO",
            addressType: "A10",
            lat: String(lat),
            lon: String(lng),
        },
    });

    const addressInfo = response.data?.addressInfo;
    if (!addressInfo) return undefined;

    const fullAddress = [
        addressInfo.fullAddressRoad,
        addressInfo.fullAddress,
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => (value as string).trim())[0];
    if (fullAddress) return fullAddress;

    const road = [
        addressInfo.city_do,
        addressInfo.gu_gun,
        addressInfo.eup_myun,
        addressInfo.legalDong,
        addressInfo.roadName,
        addressInfo.buildingIndex,
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join(" ");
    if (road) return road;

    const jibun = [
        addressInfo.city_do,
        addressInfo.gu_gun,
        addressInfo.eup_myun,
        addressInfo.legalDong,
        addressInfo.ri,
        addressInfo.bunji,
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join(" ");
    if (jibun) return jibun;

    return undefined;
}

/** 지도 공급자 호출과 대체 경로를 조율해 `searchViaNominatim` 결과를 반환합니다. */
export async function searchViaNominatim(query: string, context?: PlaceSearchContext): Promise<PlaceSearchItem[]> {
    const center = context?.center;
    const latitudeSpan = center ? Math.max(0.05, Math.min(0.4, (context?.radiusKm ?? 20) / 111)) : undefined;
    const longitudeSpan = center
        ? latitudeSpan! / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180))
        : undefined;
    const response = await nominatimClient.get("/search", {
        params: {
            q: query,
            format: "json",
            countrycodes: "kr",
            limit: 10,
            addressdetails: 1,
            ...(center && latitudeSpan && longitudeSpan
                ? {
                    viewbox: `${center.lng - longitudeSpan},${center.lat + latitudeSpan},${center.lng + longitudeSpan},${center.lat - latitudeSpan}`,
                    bounded: 0,
                }
                : {}),
        },
    });

    const items = Array.isArray(response.data) ? response.data : [];
    return items
        .map((item: any) => {
            const lat = safeNumber(item.lat);
            const lng = safeNumber(item.lon);
            if (typeof lat !== "number" || typeof lng !== "number") return null;

            const addr = item.address ?? {};
            const name: string =
                addr.railway ?? addr.subway ?? addr.station ??
                addr.amenity ?? addr.building ?? addr.tourism ??
                addr.shop ?? addr.office ?? addr.leisure ??
                ((item.display_name as string)?.split(",")[0]?.trim() ?? query);

            const road = addr.road ?? "";
            const houseNum = addr.house_number ?? "";
            const suburb = addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? "";
            const district = addr.city_district ?? addr.county ?? "";
            const city = addr.city ?? addr.town ?? addr.village ?? "";

            const roadPart = [road, houseNum].filter(Boolean).join(" ");
            const address = [roadPart, suburb, district, city].filter(Boolean).join(", ")
                || ((item.display_name as string) ?? "");

            return applySearchDistance({
                name,
                address,
                lat,
                lng,
                provider: "nominatim",
                providerPlaceId: item?.place_id === undefined || item?.place_id === null
                    ? undefined
                    : String(item.place_id),
            } as PlaceSearchItem, context);
        })
        .filter((value: PlaceSearchItem | null): value is PlaceSearchItem => value !== null);
}

/** 지도 공급자 호출과 대체 경로를 조율해 `reverseViaNominatim` 결과를 반환합니다. */
export async function reverseViaNominatim(lat: number, lng: number): Promise<string | undefined> {
    const response = await nominatimClient.get("/reverse", {
        params: { lat, lon: lng, format: "json", addressdetails: 1 },
    });
    const addr = response.data?.address;
    if (!addr) return response.data?.display_name as string | undefined;

    const road = addr.road ?? "";
    const houseNum = addr.house_number ?? "";
    const suburb = addr.suburb ?? addr.neighbourhood ?? "";
    const district = addr.city_district ?? addr.county ?? "";
    const city = addr.city ?? addr.town ?? addr.village ?? "";

    const roadPart = [road, houseNum].filter(Boolean).join(" ");
    return [roadPart, suburb, district, city].filter(Boolean).join(", ")
        || (response.data?.display_name as string);
}

/** 정규화된 경로 데이터를 조합해 `buildOsrmGuideInstruction` 결과를 생성합니다. */
export function buildOsrmGuideInstruction(step: any): string | undefined {
    const type = String(step?.maneuver?.type ?? "").toLowerCase();
    const modifier = String(step?.maneuver?.modifier ?? "").toLowerCase();
    const roadName = normalizeInstruction(step?.name);
    const direction = modifier.includes("left")
        ? "좌회전"
        : modifier.includes("right")
            ? "우회전"
            : modifier === "uturn"
                ? "유턴"
                : "직진";

    if (type === "depart" || type === "arrive") return undefined;
    if (type === "roundabout" || type === "rotary") {
        return roadName ? `회전교차로에서 ${roadName} 방면` : "회전교차로 진입";
    }
    if (type === "merge") return roadName ? `${roadName} 방면으로 합류` : "도로에 합류";
    if (type === "fork") return roadName ? `${roadName} 방면으로 ${direction}` : `갈림길에서 ${direction}`;
    if (type === "new name" || type === "continue") return roadName ? `${roadName} 따라 계속 이동` : "계속 이동";
    return roadName ? `${roadName} 방면으로 ${direction}` : direction;
}

/** 공급자 원본 값을 `parseOsrmBikeGuideSteps` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseOsrmBikeGuideSteps(route: any): RouteGuideStep[] | undefined {
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    const steps = legs.flatMap((leg: any) => Array.isArray(leg?.steps) ? leg.steps : []);
    const guides = steps.flatMap((step: any) => {
        const instruction = buildOsrmGuideInstruction(step);
        if (!instruction) return [];
        const pathCoords = Array.isArray(step?.geometry?.coordinates)
            ? dedupePathCoords(
                step.geometry.coordinates
                    .map((point: unknown) => parseLatLngPair(point))
                    .filter((coord: RoutePathCoord | null): coord is RoutePathCoord => coord !== null)
            )
            : undefined;
        const coordinate = pickFirstValidCoordinatePair([
            [step?.maneuver?.location?.[1], step?.maneuver?.location?.[0]],
            [pathCoords?.[0]?.lat, pathCoords?.[0]?.lng],
        ]);
        return [{
            instruction,
            roadName: normalizeInstruction(step?.name),
            durationMinutes: normalizeRoadSegmentTimeToMinutes(step?.duration),
            distanceMeters: safeNumber(step?.distance),
            turnType: normalizeInstruction(step?.maneuver?.type),
            coordinate,
            pathCoords: pathCoords && pathCoords.length >= 2 ? pathCoords : undefined,
        } as RouteGuideStep];
    });
    return guides.length > 0 ? guides : undefined;
}
