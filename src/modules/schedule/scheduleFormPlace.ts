import type { Place } from "./types";

type ScheduleFormPlaceInput = {
    name?: string | null;
    address?: string | null;
    lat?: number;
    lng?: number;
};

function cleanOptionalText(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function finiteCoordinate(value?: number) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

/**
 * 폼의 장소 입력을 API payload로 정규화한다.
 * 검색 공급자가 이름 없이 주소나 좌표만 돌려준 경우에도 장소를 버리지 않는다.
 */
export function buildScheduleFormPlace({
    name,
    address,
    lat,
    lng,
}: ScheduleFormPlaceInput): Place | undefined {
    const normalizedName = cleanOptionalText(name);
    const normalizedAddress = cleanOptionalText(address);
    const normalizedLat = finiteCoordinate(lat);
    const normalizedLng = finiteCoordinate(lng);

    if (
        !normalizedName
        && !normalizedAddress
        && normalizedLat === undefined
        && normalizedLng === undefined
    ) {
        return undefined;
    }

    return {
        name: normalizedName ?? normalizedAddress,
        address: normalizedAddress,
        lat: normalizedLat,
        lng: normalizedLng,
    };
}

/** 일정 목록에 표시할 읽기 쉬운 출발지/도착지 요약을 만든다. */
export function buildScheduleFormLocationName(
    origin?: Place,
    destination?: Place,
): string | undefined {
    const originLabel = cleanOptionalText(origin?.name) ?? cleanOptionalText(origin?.address);
    const destinationLabel = cleanOptionalText(destination?.name) ?? cleanOptionalText(destination?.address);

    if (originLabel && destinationLabel) return `${originLabel} → ${destinationLabel}`;
    return destinationLabel ?? originLabel;
}
