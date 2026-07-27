import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ShareInvitationAcceptScreen from "../app/share/[token]";
import ShareInboxScreen from "../app/share/inbox";
import ScheduleCalendarsScreen from "../app/schedule/calendars";
import ScheduleCalendarSelectBox from "../src/modules/schedule/components/form/ScheduleCalendarSelectBox";
import ShareInvitationSheet from "../src/modules/schedule/components/share/ShareInvitationSheet";
import * as env from "../src/api/env";
import * as scheduleSharingApi from "../src/api/scheduleSharing";
import * as scheduleCalendarsApi from "../src/api/scheduleCalendars";
import * as scheduleApi from "../src/api/schedule";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => ({}),
    useRouter: () => ({
        back: jest.fn(),
        push: jest.fn(),
        replace: jest.fn(),
    }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    }),
}));
jest.mock("expo-linking", () => ({
    createURL: jest.fn((path: string) => `nolate://${path}`),
}));
jest.mock("react-native-reanimated", () => {
    const { View } = require("react-native");
    const transition = {
        springify() { return this; },
        damping() { return this; },
        stiffness() { return this; },
        mass() { return this; },
        overshootClamping() { return this; },
        reduceMotion() { return this; },
    };
    return {
        __esModule: true,
        default: { View },
        LinearTransition: transition,
        ReduceMotion: { System: "system" },
        useReducedMotion: () => false,
    };
});
jest.mock("../src/modules/auth/AuthContext", () => ({
    useAuth: () => ({
        isAuthenticated: true,
        isCurationCompleted: true,
        isLoading: false,
    }),
}));
jest.mock("../src/modules/share/shareAttention", () => ({
    markShareInboxSeen: jest.fn(),
    readSeenShareAttentionKeys: jest.fn(),
}));
jest.mock("../src/api/scheduleSharing", () => ({
    acceptShareInvitation: jest.fn(),
    createCalendarShare: jest.fn(),
    createCalendarShareInvitation: jest.fn(),
    createCategoryShare: jest.fn(),
    createCategoryShareInvitation: jest.fn(),
    createScheduleShare: jest.fn(),
    createScheduleShareInvitation: jest.fn(),
    getCalendarShareInvitations: jest.fn(),
    getCategoryShareInvitations: jest.fn(),
    getScheduleShareInvitations: jest.fn(),
    getShareInbox: jest.fn(),
    getShareOutbox: jest.fn(),
    revokeCalendarShareInvitation: jest.fn(),
    revokeCategoryShare: jest.fn(),
    revokeCategoryShareInvitation: jest.fn(),
    revokeScheduleShare: jest.fn(),
    revokeScheduleShareInvitation: jest.fn(),
}));
jest.mock("../src/api/scheduleCalendars", () => ({
    addScheduleCalendarMember: jest.fn(),
    archiveScheduleCalendar: jest.fn(),
    createScheduleCalendar: jest.fn(),
    getScheduleCalendarMembers: jest.fn(),
    getScheduleCalendars: jest.fn(),
    leaveScheduleCalendar: jest.fn(),
    removeScheduleCalendarMember: jest.fn(),
    transferScheduleCalendarOwnership: jest.fn(),
    updateMyScheduleCalendarPreferences: jest.fn(),
    updateScheduleCalendar: jest.fn(),
    updateScheduleCalendarMember: jest.fn(),
}));
jest.mock("../src/api/schedule", () => ({
    getSchedules: jest.fn(),
    sendScheduleDepartureNudge: jest.fn(),
}));

describe("schedule sharing disabled route and UI defenses", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    test.each([
        ["share inbox", <ShareInboxScreen />],
        ["share invitation", <ShareInvitationAcceptScreen />],
        ["shared calendars", <ScheduleCalendarsScreen />],
    ])("off direct %s screen mounts no subtree and sends no API call", async (_name, screen) => {
        await act(async () => {
            renderer = TestRenderer.create(screen);
            await Promise.resolve();
        });

        expect(renderer!.toJSON()).toBeNull();
        for (const apiModule of [
            scheduleSharingApi,
            scheduleCalendarsApi,
            scheduleApi,
        ]) {
            for (const value of Object.values(apiModule)) {
                if (jest.isMockFunction(value)) {
                    expect(value).not.toHaveBeenCalled();
                }
            }
        }
    });

    test("off share sheet and calendar selector render nothing before enabled hooks/effects", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <>
                    <ShareInvitationSheet
                        visible
                        resourceType="schedule"
                        resourceId="42"
                        title="비공개 일정"
                        onClose={jest.fn()}
                    />
                    <ScheduleCalendarSelectBox
                        calendars={[]}
                        value={null}
                        onChange={jest.fn()}
                    />
                </>,
            );
            await Promise.resolve();
        });

        expect(renderer!.toJSON()).toBeNull();
        expect(scheduleSharingApi.getScheduleShareInvitations)
            .not.toHaveBeenCalled();
        expect(scheduleCalendarsApi.getScheduleCalendars)
            .not.toHaveBeenCalled();
    });
});
