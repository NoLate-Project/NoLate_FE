import { getEnv } from "../src/api/env";
import {Platform} from 'react-native';
import {
    canOpenJourneyGuidance,
    isJourneyGuidanceEnabled,
    isAutomaticJourneyEntryEnabled,
    journeyGuidanceRoute,
} from "../src/modules/journey/journeyFeature";
import type { ScheduleItem } from "../src/modules/schedule/types";

jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(),
}));
jest.mock('expo-device', () => ({ isDevice: false }));

const mockedGetEnv = jest.mocked(getEnv);

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
    return {
        id: "42",
        title: "회의",
        startAt: "2026-10-03T10:00:00+09:00",
        endAt: "2026-10-03T11:00:00+09:00",
        travelMode: "TRANSIT",
        category: { id: "work", title: "업무", color: "#0066FF" },
        routeSetupRequired: false,
        travelCollaborationEnabled: true,
        ...overrides,
    };
}

describe("journey feature gate", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it.each([undefined, "", "false", "TRUE", "1"])(
        "env=%s 일 때 기본적으로 꺼져 있다",
        (value) => {
            mockedGetEnv.mockReturnValue(value);
            expect(isJourneyGuidanceEnabled()).toBe(false);
            expect(canOpenJourneyGuidance(item())).toBe(false);
        },
    );

    it("exact lowercase true와 준비된 개인 TRANSIT 경로에서만 연다", () => {
        mockedGetEnv.mockReturnValue("true");

        expect(isJourneyGuidanceEnabled()).toBe(true);
        expect(canOpenJourneyGuidance(item())).toBe(true);
        expect(canOpenJourneyGuidance(item({ routeSetupRequired: true }))).toBe(false);
        expect(canOpenJourneyGuidance(item({ travelCollaborationEnabled: false }))).toBe(false);
        expect(canOpenJourneyGuidance(item({ travelMode: "CAR" }))).toBe(false);
        expect(canOpenJourneyGuidance(item({
            travelMode: "TRANSIT",
            myTravelPlan: {
                scheduleId: 42,
                memberId: 7,
                status: "READY",
                travelMode: "CAR",
            },
        }))).toBe(false);
        expect(canOpenJourneyGuidance(item({
            travelMode: "CAR",
            myTravelPlan: {
                scheduleId: 42,
                memberId: 7,
                status: "READY",
                travelMode: "TRANSIT",
            },
        }))).toBe(true);
    });

    it("길안내 플래그만 켜져도 사용할 수 없는 진입 화면으로 기존 출발 동작을 바꾸지 않는다", () => {
        mockedGetEnv.mockImplementation(key => key === "EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED" ? "true" : "false");
        expect(canOpenJourneyGuidance(item())).toBe(false);

        mockedGetEnv.mockReturnValue("true");
        const development = __DEV__;
        try {
            (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
            expect(canOpenJourneyGuidance(item())).toBe(false);
        } finally {
            (globalThis as unknown as { __DEV__: boolean }).__DEV__ = development;
        }
    });

    it("자동 준비 플래그만 켜져도 상세 경로의 시험 제어 화면을 노출하지 않는다", () => {
        mockedGetEnv.mockImplementation(key => key === "EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED" ? "true" : "false");
        expect(isAutomaticJourneyEntryEnabled()).toBe(false);
        expect(canOpenJourneyGuidance(item())).toBe(false);
    });

    it.each([undefined,'','false','TRUE','1','true'])('GPS entry requires its own exact flag (%s)',value=>{
        mockedGetEnv.mockImplementation(key=>key==='EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED'?value:'true');
        expect(isAutomaticJourneyEntryEnabled()).toBe(value==='true');
    });

    it('physical device entry also requires the separate field-test flag', () => {
        const device = require('expo-device') as { isDevice: boolean };
        device.isDevice = true;
        try {
            mockedGetEnv.mockImplementation(key => key === 'EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED' ? 'true' : 'false');
            expect(isAutomaticJourneyEntryEnabled()).toBe(false);
            mockedGetEnv.mockReturnValue('true');
            expect(isAutomaticJourneyEntryEnabled()).toBe(true);
        } finally {
            device.isDevice = false;
        }
    });

    it('GPS entry remains disabled on Android and release builds even with both flags',()=>{
        mockedGetEnv.mockReturnValue('true');
        const os=Platform.OS,dev=__DEV__;
        try {
            Object.defineProperty(Platform,'OS',{configurable:true,value:'android'});
            expect(isAutomaticJourneyEntryEnabled()).toBe(false);
            Object.defineProperty(Platform,'OS',{configurable:true,value:'ios'});
            (globalThis as unknown as {__DEV__:boolean}).__DEV__=false;
            expect(isAutomaticJourneyEntryEnabled()).toBe(false);
        } finally {
            Object.defineProperty(Platform,'OS',{configurable:true,value:os});
            (globalThis as unknown as {__DEV__:boolean}).__DEV__=dev;
        }
    });

    it("journey 화면 경로에는 scheduleId만 전달한다", () => {
        expect(journeyGuidanceRoute("42")).toEqual({
            pathname: "/schedule/journey",
            params: { scheduleId: "42" },
        });
    });
});
