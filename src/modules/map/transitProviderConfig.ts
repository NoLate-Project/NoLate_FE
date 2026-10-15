import { getEnv } from "../../api/env";

/** TMAP은 명시적으로 선택한 개발/테스트 빌드에서만 허용한다. 배포 기본값은 ODsay다. */
export function getTransitRouteProvider(): "odsay" | "tmap" {
    return typeof __DEV__ === "boolean" && __DEV__ &&
        getEnv("EXPO_PUBLIC_TRANSIT_PROVIDER") === "tmap"
        ? "tmap"
        : "odsay";
}
