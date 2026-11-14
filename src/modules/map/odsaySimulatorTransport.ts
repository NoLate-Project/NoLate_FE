import axios from "axios";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { getEnv } from "../../api/env";
import { OdsayApiError } from "./odsayApiError";

const FIXTURE_API = "http://127.0.0.1:5523";

/** Explicit synthetic transport only. Never accepts a host URL or a real key. */
export async function getIsolatedOdsaySimulatorTransport(): Promise<{
    baseUrl: string; apiKey: string;
} | undefined> {
    if (getEnv("EXPO_PUBLIC_ODSAY_ISOLATED_SIMULATOR_FIXTURE") !== "1") return undefined;
    // A requested but invalid fixture must fail closed, never fall back to
    // the public provider and silently turn a synthetic E2E into a real call.
    if (!__DEV__ || Platform.OS !== "ios" || Device.isDevice !== false ||
        getEnv("EXPO_PUBLIC_LOCAL_API_BASE_URL") !== FIXTURE_API) {
        throw new OdsayApiError("FIXTURE_REFUSED", "격리 시뮬레이터 환경이 아닙니다.");
    }
    try {
        const ready = await axios.get(`${FIXTURE_API}/health/readiness`, { timeout: 3000, maxRedirects: 0 });
        if (ready.status !== 200 || ready.headers["x-nolate-eta-fixture"] !== "h2-memory-only" ||
            ready.data?.status !== "UP") throw new Error("unmarked_fixture");
    } catch {
        throw new OdsayApiError("FIXTURE_NOT_READY", "격리 길찾기 서버를 확인할 수 없습니다.");
    }
    return { baseUrl: `${FIXTURE_API}/__eta_fixture__/odsay`, apiKey: "synthetic-fixture-no-provider-key" };
}
