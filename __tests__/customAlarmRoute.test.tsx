import * as Crypto from "expo-crypto";
import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import NoLateCustomAlarmRoute from "../app/alarm";
import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    consumeNoLateCustomAlarmCapability,
    hasNoLateCustomAlarmCapability,
    issueNoLateCustomAlarmCapability,
    resetNoLateCustomAlarmCapabilitiesForTests,
} from "../src/modules/notification/customAlarmCapability";
import {
    createNoLateCustomAlarmRoute,
    type NoLateCustomAlarmNavigationTarget,
} from "../src/modules/notification/customAlarmNavigation";

let mockParams: Record<string, string | undefined> = {};
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
const mockCompleteDeparture = jest.fn();
const mockGetSchedule = jest.fn();

jest.mock("expo-crypto", () => ({
    randomUUID: jest.fn(),
}));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => mockParams,
    useRouter: () => ({
        back: mockBack,
        replace: mockReplace,
        canGoBack: mockCanGoBack,
    }),
}));
jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));
jest.mock("../src/modules/notification/foregroundPush", () => ({
    completeDepartureFromNotificationAction: (...args: unknown[]) =>
        mockCompleteDeparture(...args),
}));
jest.mock("../src/api/schedule", () => ({
    getSchedule: (...args: unknown[]) => mockGetSchedule(...args),
}));
jest.mock("../src/modules/notification/NoLateCustomAlarmScreen", () => {
    const ReactModule = require("react");
    return function MockNoLateCustomAlarmScreen(props: Record<string, unknown>) {
        return ReactModule.createElement("NoLateCustomAlarmScreen", {
            ...props,
            testID: "mock-custom-alarm-screen",
        });
    };
});

const mockedRandomUuid = jest.mocked(Crypto.randomUUID);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const capabilityId = "44444444-4444-4444-8444-444444444444";
const previewId = "5ef854e8-32de-4fde-98fa-280c2e9772dd";
const actionEventKey = `key:${"a".repeat(64)}`;

const actualTarget: NoLateCustomAlarmNavigationTarget = {
    kind: "customAlarm",
    alarmId: "schedule:42:member:7",
    nativeAlarmId: "schedule:42:member:7:occurrence:M0",
    notificationIdentifier: "nolate.departure.schedule-42-M0",
    scheduleId: "42",
    recipientMemberId: 7,
    alarmGeneration: 8,
    actionEventKey,
    occurrenceId: "M0",
    title: "지금 출발하세요",
    isPreview: false,
    requestedAction: "confirmDeparture",
};

describe("/alarm route", () => {
    let renderer: ReactTestRenderer | undefined;
    let authorizedTarget: NoLateCustomAlarmNavigationTarget & { capabilityId: string };

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        resetNoLateCustomAlarmCapabilitiesForTests();
        mockedRandomUuid.mockReset().mockReturnValue(capabilityId);
        authorizedTarget = issueNoLateCustomAlarmCapability(actualTarget);
        mockParams = createNoLateCustomAlarmRoute(authorizedTarget).params;
        mockBack.mockReset();
        mockReplace.mockReset();
        mockCanGoBack.mockReset().mockReturnValue(true);
        mockCompleteDeparture.mockReset().mockResolvedValue(undefined);
        mockGetSchedule.mockReset().mockResolvedValue({
            id: "42",
            title: "QA0713A 강남역 이동",
        });
        mockedGetAuthMember.mockReset().mockResolvedValue({ id: 7 } as Awaited<
            ReturnType<typeof getAuthMember>
        >);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        resetNoLateCustomAlarmCapabilitiesForTests();
    });

    async function renderRoute() {
        await act(async () => {
            renderer = TestRenderer.create(<NoLateCustomAlarmRoute />);
            await Promise.resolve();
            await Promise.resolve();
        });
        return renderer!.root.findByProps({ testID: "mock-custom-alarm-screen" });
    }

    test("routes one capability-backed real alarm to the departure-completion flow", async () => {
        const screen = await renderRoute();

        await expect(screen.props.onCompleteDeparture("42")).resolves.toEqual({
            status: "completed",
        });

        expect(mockedGetAuthMember).toHaveBeenCalledTimes(1);
        expect(mockCompleteDeparture).toHaveBeenCalledWith("42");
        expect(hasNoLateCustomAlarmCapability(authorizedTarget)).toBe(false);

        await expect(screen.props.onCompleteDeparture("42")).resolves.toEqual({
            status: "rejected",
            reason: "capability-unavailable",
        });
        expect(mockCompleteDeparture).toHaveBeenCalledTimes(1);
    });

    test("releases a claimed capability after a retryable completion failure", async () => {
        const screen = await renderRoute();
        mockCompleteDeparture
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(undefined);

        await expect(screen.props.onCompleteDeparture("42")).rejects.toThrow("offline");
        expect(hasNoLateCustomAlarmCapability(authorizedTarget)).toBe(true);

        await expect(screen.props.onCompleteDeparture("42")).resolves.toEqual({
            status: "completed",
        });
        expect(mockCompleteDeparture).toHaveBeenCalledTimes(2);
        expect(hasNoLateCustomAlarmCapability(authorizedTarget)).toBe(false);
    });

    test("rejects a capability when the active account is not its recipient", async () => {
        mockedGetAuthMember.mockResolvedValue({ id: 8 } as Awaited<
            ReturnType<typeof getAuthMember>
        >);
        const screen = await renderRoute();

        await expect(screen.props.onCompleteDeparture("42"))
            .rejects.toThrow("CUSTOM_ALARM_ACCOUNT_MISMATCH");

        expect(mockCompleteDeparture).not.toHaveBeenCalled();
        expect(hasNoLateCustomAlarmCapability(authorizedTarget)).toBe(false);

        await expect(screen.props.onCompleteDeparture("42")).resolves.toEqual({
            status: "rejected",
            reason: "capability-unavailable",
        });
    });

    test("returns an explicit rejection when the capability is no longer available", async () => {
        const screen = await renderRoute();
        consumeNoLateCustomAlarmCapability(authorizedTarget.capabilityId);

        await expect(screen.props.onCompleteDeparture("42")).resolves.toEqual({
            status: "rejected",
            reason: "capability-unavailable",
        });

        expect(mockedGetAuthMember).not.toHaveBeenCalled();
        expect(mockCompleteDeparture).not.toHaveBeenCalled();
    });

    test("keeps a capability-backed preview UI-only", async () => {
        const previewTarget = issueNoLateCustomAlarmCapability({
            kind: "customAlarm",
            alarmId: `preview:${previewId}`,
            notificationIdentifier: "nolate.custom-alarm.preview.current",
            previewId,
            scheduleId: "42",
            isPreview: true,
            requestedAction: "confirmDeparture",
        });
        mockParams = createNoLateCustomAlarmRoute(previewTarget).params;
        const screen = await renderRoute();

        expect(mockGetSchedule).toHaveBeenCalledWith("42");
        expect(screen.props.presentation.title).toBe("QA0713A 강남역 이동");

        await expect(screen.props.onCompleteDeparture("42")).resolves.toEqual({
            status: "rejected",
            reason: "invalid-presentation",
        });

        expect(mockedGetAuthMember).not.toHaveBeenCalled();
        expect(mockCompleteDeparture).not.toHaveBeenCalled();
    });

    test.each([
        ["copied query", {
            capabilityId: "55555555-5555-4555-8555-555555555555",
        }],
        ["missing payload type", { type: undefined }],
        ["tampered recipient", { recipientMemberId: "8" }],
    ])("keeps a forged %s inert", async (_label, override) => {
        mockParams = {
            ...createNoLateCustomAlarmRoute(authorizedTarget).params,
            ...override,
        };
        const screen = await renderRoute();

        await expect(screen.props.onCompleteDeparture("42")).resolves.toEqual({
            status: "rejected",
            reason: "invalid-presentation",
        });

        expect(mockedGetAuthMember).not.toHaveBeenCalled();
        expect(mockCompleteDeparture).not.toHaveBeenCalled();
    });

    test("rejects a mismatched schedule id supplied by a child action", async () => {
        const screen = await renderRoute();

        await expect(screen.props.onCompleteDeparture("41")).resolves.toEqual({
            status: "rejected",
            reason: "invalid-presentation",
        });

        expect(mockedGetAuthMember).not.toHaveBeenCalled();
        expect(mockCompleteDeparture).not.toHaveBeenCalled();
        expect(hasNoLateCustomAlarmCapability(authorizedTarget)).toBe(true);
    });

    test("opens the existing route-detail entry and closes safely", async () => {
        const screen = await renderRoute();

        screen.props.onOpenRoute("42");
        expect(mockReplace).toHaveBeenCalledWith({
            pathname: "/schedule/[id]",
            params: { id: "42", openRouteDetail: "1" },
        });

        screen.props.onClose();
        expect(mockBack).toHaveBeenCalledTimes(1);

        mockCanGoBack.mockReturnValue(false);
        screen.props.onClose();
        expect(mockReplace).toHaveBeenCalledWith("/schedule");
    });
});
