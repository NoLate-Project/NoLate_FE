type Coords = {
    latitude: number;
    longitude: number;
};

type Position = {
    coords: Coords;
};

// 현재 위치는 route-planner / 위치 선택 모달 등에서 공통으로 사용하므로
// 브라우저 geolocation 접근을 여기서 한 번 감싸서 에러 메시지와 옵션을 통일한다.
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
                timeout: 12000,
                maximumAge: 5000,
            }
        );
    });

    return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
    };
}
