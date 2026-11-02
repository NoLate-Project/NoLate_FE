import { getEnv } from "../../api/env";

/** 배포 기본값은 ODsay다. 운영에서 TMAP을 선택할 때는 서버 프록시가 반드시 필요하다. */
export function getTransitRouteProvider(): "odsay" | "tmap" {
    if (getEnv("EXPO_PUBLIC_TRANSIT_PROVIDER") !== "tmap") return "odsay";
    if (typeof __DEV__ !== "boolean") return "odsay";
    return __DEV__ || getEnv("EXPO_PUBLIC_ROUTE_API_PROXY_ENABLED") === "true"
        ? "tmap"
        : "odsay";
}
