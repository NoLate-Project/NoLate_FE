import * as Location from "expo-location";

type Coords = {
    latitude: number;
    longitude: number;
};

// 위치 조회 옵션은 앱 전역에서 동일하게 유지한다.
const GEO_TIMEOUT_MS = 12000;
const GEO_MAX_AGE_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error("현재 위치를 가져오는 데 시간이 오래 걸립니다. 잠시 후 다시 시도해 주세요."));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function ensureForegroundPermission() {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
        throw new Error("기기 위치 서비스가 꺼져 있습니다. 위치 서비스를 켠 뒤 다시 시도해 주세요.");
    }

    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return;

    const requested = await Location.requestForegroundPermissionsAsync();
    if (!requested.granted) {
        throw new Error("위치 권한을 허용해 주세요.");
    }
}

// route-planner/위치 선택 모달에서 공통으로 쓰는 현재 위치 조회 래퍼.
export async function getCurrentLocation(): Promise<Coords> {
    await ensureForegroundPermission();

    const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: GEO_MAX_AGE_MS,
        requiredAccuracy: 100,
    });
    const position = lastKnown ?? await withTimeout(
        Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            mayShowUserSettingsDialog: true,
        }),
        GEO_TIMEOUT_MS
    );

    return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
    };
}
