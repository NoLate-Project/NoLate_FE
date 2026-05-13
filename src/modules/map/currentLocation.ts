type Coords = {
    latitude: number;
    longitude: number;
};

type Position = {
    coords: Coords;
};

// 위치 조회 옵션은 앱 전역에서 동일하게 유지한다.
const GEO_TIMEOUT_MS = 12000;
const GEO_MAX_AGE_MS = 5000;

// route-planner/위치 선택 모달에서 공통으로 쓰는 현재 위치 조회 래퍼.
export async function getCurrentLocation(): Promise<Coords> {
    const geolocation = (globalThis as any)?.navigator?.geolocation;
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
        throw new Error("현재 위치 기능을 사용할 수 없습니다.");
    }

    const position = await new Promise<Position>((resolve, reject) => {
        geolocation.getCurrentPosition(
            (value: Position) => resolve(value),
            () => reject(new Error("위치 권한을 허용해 주세요.")),
            {
                enableHighAccuracy: true,
                timeout: GEO_TIMEOUT_MS,
                maximumAge: GEO_MAX_AGE_MS,
            }
        );
    });

    return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
    };
}
