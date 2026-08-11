import type { PlaceSearchItem } from "../../src/modules/map/routingService";
import type { Place, TravelMode } from "../../src/modules/schedule/types";
import {
    SELECTABLE_TRAVEL_MODES,
    type PlaceIconSource,
    type PlaceListIconName,
} from "./RouteSelectAnimatedControls";

/** 이름·주소·좌표 입력을 정리해 유효한 장소 모델을 만들고 정보가 전혀 없으면 생성하지 않는다. */
export function buildPlace(name: string, address: string | undefined, lat?: number, lng?: number): Place | undefined {
    const normalizedName = name.trim();
    const normalizedAddress = address?.trim();
    if (!normalizedName && !normalizedAddress && typeof lat !== "number" && typeof lng !== "number") return undefined;
    return {
        name: normalizedName || normalizedAddress || "위치",
        address: normalizedAddress || undefined,
        lat,
        lng,
    };
}

/** 장소가 지도와 경로 검색에 사용할 수 있는 유한한 위도·경도를 모두 갖는지 판별한다. */
export function placeHasCoords(place: Place | null | undefined): place is Place & { lat: number; lng: number } {
    return typeof place?.lat === "number" && Number.isFinite(place.lat) &&
        typeof place.lng === "number" && Number.isFinite(place.lng);
}

/** 장소 이름을 우선 사용하고 없으면 주소 또는 기본 출발지 문구를 반환한다. */
export function getPlaceDisplayText(place: Place): string {
    return place.name?.trim() || place.address?.trim() || "출발지";
}

/** 좌표와 이름·주소를 조합해 최근 장소 및 즐겨찾기 동작을 식별할 안정적인 키를 만든다. */
export function getPlaceActionKey(place: Place): string {
    return [
        place.lat ?? "x",
        place.lng ?? "x",
        place.name?.trim() || "",
        place.address?.trim() || "",
    ].join(":");
}

/** 지도 검색 결과를 일정 경로 선택에서 사용하는 장소 모델로 변환한다. */
export function buildPlaceFromSearchItem(item: PlaceSearchItem): Place {
    return {
        name: item.name,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        provider: item.provider,
        providerPlaceId: item.providerPlaceId,
    };
}

/** 정규화된 장소 설명에 후보 키워드 중 하나라도 포함되는지 확인한다. */
export function textIncludesAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
}

/** 장소의 분류·이름·주소 키워드를 분석해 목록에서 가장 적절한 의미 아이콘을 선택한다. */
export function resolvePlaceListIcon(source: PlaceIconSource): PlaceListIconName {
    const text = [
        source.category,
        source.name,
        source.address,
    ].filter(Boolean).join(" ").toLowerCase();

    if (textIncludesAny(text, ["출구", "exit"]) || /\d+\s*번\s*출구/.test(text)) {
        return "exit-outline";
    }
    if (textIncludesAny(text, ["버스", "정류장", "정류소", "bus"])) {
        return "bus-outline";
    }
    if (textIncludesAny(text, ["지하철", "전철", "도시철도", "철도", "ktx", "호선"]) || /역(\s|$|\[|\(|\d)/.test(text)) {
        return "train-outline";
    }
    if (textIncludesAny(text, ["공항", "터미널", "airport"])) {
        return "airplane-outline";
    }
    if (textIncludesAny(text, ["집", "아파트", "빌라", "오피스텔", "주택", "home"])) {
        return "home-outline";
    }
    if (textIncludesAny(text, ["회사", "사무실", "오피스", "빌딩", "센터", "business", "office"])) {
        return "business-outline";
    }
    if (textIncludesAny(text, ["카페", "커피", "cafe", "coffee"])) {
        return "cafe-outline";
    }
    if (textIncludesAny(text, ["음식", "식당", "맛집", "레스토랑", "restaurant", "food"])) {
        return "restaurant-outline";
    }
    if (textIncludesAny(text, ["학교", "대학교", "캠퍼스", "학원", "school", "university"])) {
        return "school-outline";
    }
    if (textIncludesAny(text, ["병원", "약국", "의원", "치과", "medical", "hospital", "pharmacy"])) {
        return "medical-outline";
    }
    if (textIncludesAny(text, ["마트", "백화점", "상가", "몰", "쇼핑", "store", "mall", "shop"])) {
        return "cart-outline";
    }
    if (textIncludesAny(text, ["호텔", "모텔", "숙소", "hotel"])) {
        return "bed-outline";
    }
    if (textIncludesAny(text, ["주차", "parking"])) {
        return "car-outline";
    }

    return "location-outline";
}

// 딥링크 URL로 전달된 첫 번째 문자열 값을 꺼낸다.
/** 단일값 또는 배열 형태의 라우트 파라미터에서 첫 문자열 값을 안전하게 꺼낸다. */
export function readParam(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

// URL 파라미터로 전달된 좌표 문자열을 숫자로 변환한다.
/** 라우트 파라미터를 유한한 숫자로 변환하고 변환할 수 없으면 값을 버린다. */
export function readNumberParam(value: string | string[] | undefined): number | undefined {
    const rawValue = readParam(value);
    if (!rawValue) return undefined;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : undefined;
}

// URL 파라미터의 이동수단 값이 앱에서 쓰는 타입인지 확인한다.
/** 라우트 파라미터가 앱에서 지원하는 이동수단인지 검증한 뒤 타입이 보장된 값만 반환한다. */
export function readTravelModeParam(value: string | string[] | undefined): TravelMode | undefined {
    const rawValue = readParam(value);
    return SELECTABLE_TRAVEL_MODES.includes(rawValue as TravelMode) ? rawValue as TravelMode : undefined;
}
