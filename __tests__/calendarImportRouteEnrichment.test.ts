import {
    enableCalendarImportNotification,
    enrichCalendarCandidateWithRoute,
    extractCalendarRouteHints,
} from "../src/modules/onboarding/calendarImportRouteEnrichment";
import type { DeviceCalendarCandidate } from "../src/modules/onboarding/deviceCalendarImport";
import { buildSavedRouteMapPresentation } from "../src/modules/map/savedRouteMapPresentation";

const CANDIDATE: DeviceCalendarCandidate = {
    id: "APPLE_DEVICE:calendar:event:2099-01-02T12:00:00.000Z",
    provider: "APPLE_DEVICE",
    eventId: "event",
    calendarId: "calendar",
    calendarTitle: "개인",
    title: "고객 미팅",
    startAt: "2099-01-02T12:00:00.000Z",
    endAt: "2099-01-02T13:00:00.000Z",
    allDay: false,
    locationName: "코엑스",
    notes: "출발지: 서울역\n도착지: 코엑스",
    requiresTimeReview: false,
    recommended: true,
};

const SETTINGS = {
    category: { id: "1", title: "개인", color: "#2196f3" },
    travelMode: "TRANSIT" as const,
    travelMinutes: 30,
    prepareDepartureAlert: true,
};

describe("calendar import route enrichment", () => {
    test("캘린더 장소와 메모 라벨에서 출발지·도착지를 추출한다", () => {
        expect(extractCalendarRouteHints(CANDIDATE)).toEqual({
            originQuery: "서울역",
            destinationQuery: "코엑스",
            originSource: "notes",
            destinationSource: "calendar_location",
        });
    });

    test("제목이나 메모의 화살표 이동 표현도 경로 후보로 사용한다", () => {
        expect(extractCalendarRouteHints({
            ...CANDIDATE,
            title: "서울역 → 판교역",
            locationName: undefined,
            notes: undefined,
        })).toEqual({
            originQuery: "서울역",
            destinationQuery: "판교역",
            originSource: "title",
            destinationSource: "title",
        });
    });

    test("한 줄에 이어 적은 출발지와 도착지 라벨도 각각 분리한다", () => {
        expect(extractCalendarRouteHints({
            ...CANDIDATE,
            locationName: undefined,
            notes: "출발지: 서울역 도착지: 코엑스",
        })).toMatchObject({
            originQuery: "서울역",
            destinationQuery: "코엑스",
        });
    });

    test("화상회의 URL은 실제 목적지로 취급하지 않는다", () => {
        expect(extractCalendarRouteHints({
            ...CANDIDATE,
            locationName: "https://meet.google.com/abc-defg-hij",
            notes: undefined,
        }).destinationQuery).toBeUndefined();
    });

    test("좌표 검색과 경로 조회가 성공하면 저장 가능한 경로 payload를 만든다", async () => {
        const resolvePlace = jest.fn(async (query: string) => {
            if (query === "서울역") return { name: "서울역", address: "서울 중구", lat: 37.5547, lng: 126.9706 };
            if (query === "코엑스") return { name: "코엑스", address: "서울 강남구", lat: 37.5116, lng: 127.0595 };
            return undefined;
        });
        const findRoutes = jest.fn(async () => [
            {
                id: "slow",
                mode: "TRANSIT" as const,
                minutes: 42,
                source: "api" as const,
                provider: "tmap" as const,
                pathCoords: [{ lat: 37.5547, lng: 126.9706 }, { lat: 37.5116, lng: 127.0595 }],
            },
            {
                id: "fast",
                mode: "TRANSIT" as const,
                minutes: 35,
                source: "api" as const,
                provider: "tmap" as const,
                pathCoords: [{ lat: 37.5547, lng: 126.9706 }, { lat: 37.5116, lng: 127.0595 }],
            },
        ]);

        const result = await enrichCalendarCandidateWithRoute(
            CANDIDATE,
            SETTINGS,
            { name: "집", address: "서울 용산구", lat: 37.53, lng: 126.96 },
            { resolvePlace, findRoutes }
        );

        expect(result.routePrepared).toBe(true);
        expect(result.payload).toMatchObject({
            travelMinutes: 35,
            departAt: "2099-01-02T11:25:00.000Z",
            travelMode: "TRANSIT",
            origin: { name: "서울역", lat: 37.5547, lng: 126.9706 },
            destination: { name: "코엑스", lat: 37.5116, lng: 127.0595 },
            locationName: "서울역 → 코엑스",
            route: {
                id: "fast",
                mode: "TRANSIT",
                source: "api",
                pathCoords: [
                    { lat: 37.5547, lng: 126.9706 },
                    { lat: 37.5116, lng: 127.0595 },
                ],
                routeInfo: {
                    id: "fast",
                    totalDurationMinutes: 35,
                },
            },
            notificationEnabled: false,
        });

        const presentation = buildSavedRouteMapPresentation({
            route: result.payload.route,
            origin: result.payload.origin,
            destination: result.payload.destination,
            mapZoom: 13,
            isDark: false,
        });
        expect(presentation.pathOverlays).toHaveLength(1);
        expect(presentation.pathOverlays[0]?.coords).toHaveLength(2);
    });

    test("메모에 출발지가 없으면 사용자가 지정한 공통 출발지를 사용한다", async () => {
        const defaultOrigin = { name: "집", address: "서울 용산구", lat: 37.53, lng: 126.96 };
        const result = await enrichCalendarCandidateWithRoute(
            { ...CANDIDATE, notes: undefined },
            SETTINGS,
            defaultOrigin,
            {
                resolvePlace: async () => ({ name: "코엑스", lat: 37.5116, lng: 127.0595 }),
                findRoutes: async () => [{
                    id: "route",
                    mode: "TRANSIT",
                    minutes: 40,
                    source: "api",
                    provider: "tmap",
                    pathCoords: [{ lat: 37.53, lng: 126.96 }, { lat: 37.5116, lng: 127.0595 }],
                }],
            }
        );

        expect(result.payload.origin).toEqual(defaultOrigin);
        expect(result.routePrepared).toBe(true);
    });

    test("완성된 경로에만 구독 정책의 알림 주기를 적용한다", async () => {
        const result = await enrichCalendarCandidateWithRoute(
            { ...CANDIDATE, notes: undefined },
            SETTINGS,
            { name: "집", lat: 37.53, lng: 126.96 },
            {
                resolvePlace: async () => ({ name: "코엑스", lat: 37.5116, lng: 127.0595 }),
                findRoutes: async () => [{
                    id: "route",
                    mode: "TRANSIT",
                    minutes: 40,
                    source: "api",
                    provider: "tmap",
                    pathCoords: [{ lat: 37.53, lng: 126.96 }, { lat: 37.5116, lng: 127.0595 }],
                }],
            }
        );

        expect(enableCalendarImportNotification(result.payload, 20)).toMatchObject({
            notificationEnabled: true,
            notificationLeadMinutes: 15,
            notificationIntervalMinutes: 20,
        });
    });
});
