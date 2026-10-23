import axios from "axios";
import { getEnv } from "../src/api/env";
import { getRouteAlternativeOptions as getProviderRouteOptions, getTransitRouteOptions } from "../src/modules/map/tmapApi";
import { getRouteAlternativeOptions, invalidateRouteSearch } from "../src/modules/map/routingService";
import { hasTransitRouteProvider } from "../src/modules/map/tmapApiCore";
import type { Place } from "../src/modules/schedule/types";

jest.mock("axios");
jest.mock("../src/api/env", () => ({ getEnv: jest.fn() }));

const mockedGetEnv = jest.mocked(getEnv);
const mockedGet = jest.mocked(axios.get);
const mockedCreate = jest.mocked(axios.create);
const mockRoadPost = jest.fn();
const origin: Place = { name: "노원역", lat: 37.656, lng: 127.063 };
const destination: Place = { name: "신림역", lat: 37.484, lng: 126.93 };
const departureAt = new Date("2026-10-03T15:51:00.000Z");
const runtime = globalThis as typeof globalThis & { __DEV__: boolean | undefined };
const originalDevelopmentMode = runtime.__DEV__;

function odsayRouteResponse() {
    return { data: { result: { paths: [{
        pathType: 2,
        totalTime: 65,
        startDateTime: "202610040051",
        endDateTime: "202610040156",
        rps: [{
            trafficType: 1,
            duration: 65,
            graph: "127.063 37.656|126.93 37.484",
            lane: [{ name: "4호선", subwayCode: 4, subwayCityCode: 1000 }],
            startID: 411,
            endID: 433,
        }],
    }] } } };
}

function expectNoTmapTransitFallback() {
    expect(mockedCreate).not.toHaveBeenCalled();
}

describe("transit route provider selection", () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.spyOn(console, "info").mockImplementation(() => {});
        runtime.__DEV__ = true;
        invalidateRouteSearch(origin, destination, "TRANSIT");
        // 이전 TMAP 선택값·키·프록시 설정이 있어도 대중교통은 ODsay만 사용한다.
        mockedGetEnv.mockImplementation((key) => {
            if (key === "EXPO_PUBLIC_TRANSIT_PROVIDER") return "tmap";
            if (["EXPO_PUBLIC_ODSAY_IOS_API_KEY", "EXPO_PUBLIC_ODSAY_ANDROID_API_KEY"].includes(key)) return "test-odsay-key";
            if (key === "EXPO_PUBLIC_TMAP_APP_KEY") return "test-tmap-key";
            return undefined;
        });
        mockedCreate.mockReturnValue({ post: mockRoadPost } as unknown as ReturnType<typeof axios.create>);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        runtime.__DEV__ = originalDevelopmentMode;
    });

    test("returns ODsay identity and preserves unverified operating and timing evidence", async () => {
        expect(hasTransitRouteProvider()).toBe(true);
        mockedGet.mockResolvedValue(odsayRouteResponse());

        const [route] = await getRouteAlternativeOptions(origin, destination, "TRANSIT", { departureAt });

        expect(mockedGet).toHaveBeenCalledTimes(1);
        expect(mockedGet).toHaveBeenCalledWith("https://api.odsay.com/v1/api/maasRP", expect.objectContaining({
            params: expect.objectContaining({ SearchTime: "202610040051", SearchMethod: 2 }),
        }));
        expect(route).toMatchObject({
            mode: "TRANSIT",
            provider: "odsay",
            providerTimeBasis: "route_estimate",
            providerDepartureAt: "2026-10-03T15:51:00.000Z",
            providerArrivalAt: "2026-10-03T16:56:00.000Z",
            transitServiceState: "unknown",
            routeReliability: "provider_estimate",
        });
        expect(route.transitLegs?.[0].serviceAvailable).toBeUndefined();
        expectNoTmapTransitFallback();
    });

    test.each([true, false, undefined])("uses ODsay with development mode %s despite a stale TMAP setting", async (developmentMode) => {
        runtime.__DEV__ = developmentMode;
        mockedGet.mockResolvedValue(odsayRouteResponse());

        const [route] = await getTransitRouteOptions(origin, destination, { departureAt });

        expect(route.provider).toBe("odsay");
        expect(mockedGet).toHaveBeenCalledTimes(1);
        expectNoTmapTransitFallback();
    });

    test("a stale provider switch does not change the cached ODsay route", async () => {
        mockedGet.mockResolvedValue(odsayRouteResponse());

        const [odsayRoute] = await getRouteAlternativeOptions(origin, destination, "TRANSIT", { departureAt });
        const [sameRoute] = await getRouteAlternativeOptions(origin, destination, "TRANSIT", { departureAt });

        expect(odsayRoute.provider).toBe("odsay");
        expect(sameRoute.provider).toBe("odsay");
        expect(mockedGet).toHaveBeenCalledTimes(1);
        expectNoTmapTransitFallback();
    });

    test("missing ODsay key is a provider failure even when TMAP is configured", async () => {
        mockedGetEnv.mockImplementation((key) => key === "EXPO_PUBLIC_TMAP_APP_KEY" ? "test-tmap-key" : undefined);
        expect(hasTransitRouteProvider()).toBe(false);

        await expect(getRouteAlternativeOptions(origin, destination, "TRANSIT", { departureAt }))
            .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

        expect(mockedGet).not.toHaveBeenCalled();
        expectNoTmapTransitFallback();
    });

    test("ODsay transport failure is propagated by the direct transit entry point", async () => {
        const failure = new Error("ODsay request timed out");
        mockedGet.mockRejectedValue(failure);

        await expect(getTransitRouteOptions(origin, destination, { departureAt })).rejects.toBe(failure);

        expectNoTmapTransitFallback();
    });

    test("ODsay API error remains a provider failure and is not replaced by a TMAP success", async () => {
        mockedGet.mockResolvedValue({ data: { error: { code: "-7", msg: "test quota exhausted" } } });

        await expect(getRouteAlternativeOptions(origin, destination, "TRANSIT", { departureAt }))
            .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

        expect(mockedGet).toHaveBeenCalledTimes(1);
        expectNoTmapTransitFallback();
    });

    test("an empty ODsay route result stays empty rather than becoming a TMAP route", async () => {
        mockedGet.mockResolvedValue({ data: { result: { paths: [] } } });

        await expect(getRouteAlternativeOptions(origin, destination, "TRANSIT", { departureAt }))
            .rejects.toMatchObject({ code: "NO_PROVIDER_ROUTE" });

        expect(mockedGet).toHaveBeenCalledTimes(1);
        expectNoTmapTransitFallback();
    });

    test.each([
        { error: [{ code: "429", msg: "Daily quota exceeded" }] },
        { result: { error: [{ code: "429", msg: "Daily quota exceeded" }] } },
        { error: { code: "429", msg: "Daily quota exceeded" } },
    ])("HTTP 200 ODsay quota errors remain explicit without TMAP fallback: %j", async (data) => {
        mockedGet.mockResolvedValue({ status: 200, data });

        await expect(getRouteAlternativeOptions(origin, destination, "TRANSIT", { departureAt }))
            .rejects.toMatchObject({
                code: "PROVIDER_QUOTA_EXCEEDED",
                message: "대중교통 경로 제공사의 조회 한도를 초과했습니다. 한도 복구 후 다시 이용해 주세요.",
            });
        expect(mockedGet).toHaveBeenCalledTimes(1);
        expectNoTmapTransitFallback();
    });

    test("HTTP 429 is also classified without leaking the request or retrying TMAP", async () => {
        const failure = { response: { status: 429 }, code: "ERR_BAD_REQUEST" };
        jest.mocked(axios.isAxiosError).mockReturnValue(true);
        mockedGet.mockRejectedValue(failure);

        await expect(getRouteAlternativeOptions(origin, destination, "TRANSIT", { departureAt }))
            .rejects.toMatchObject({ code: "PROVIDER_QUOTA_EXCEEDED" });
        expect(mockedGet).toHaveBeenCalledTimes(1);
        expectNoTmapTransitFallback();
    });

    test.each([
        ["CAR", "/tmap/routes", 3],
        ["WALK", "/tmap/routes/pedestrian", 2],
    ] as const)("keeps the existing TMAP %s path", async (mode, endpoint, requestCount) => {
        mockRoadPost.mockResolvedValue({ data: {
            type: "FeatureCollection",
            features: [{
                type: "Feature",
                properties: { totalTime: 600, totalDistance: 1000 },
                geometry: { type: "LineString", coordinates: [[127.063, 37.656], [126.93, 37.484]] },
            }],
        } });

        const routes = await getProviderRouteOptions(origin, destination, mode);

        expect(routes.length).toBeGreaterThan(0);
        expect(routes.every((route) => route.provider === "tmap" && route.mode === mode)).toBe(true);
        expect(mockRoadPost).toHaveBeenCalledTimes(requestCount);
        expect(mockRoadPost).toHaveBeenCalledWith(endpoint, expect.any(String), expect.any(Object));
        expect(mockedGet).not.toHaveBeenCalled();
    });
});
