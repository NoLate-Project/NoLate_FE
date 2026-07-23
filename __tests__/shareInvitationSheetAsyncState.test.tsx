import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ShareInvitationSheet from "../src/modules/schedule/components/share/ShareInvitationSheet";
import { getScheduleShareInvitations } from "../src/api/scheduleSharing";
import type { ScheduleShareInvitation } from "../src/api/scheduleSharing";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-linking", () => ({ createURL: (path: string) => `nolate://${path}` }));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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
        useReducedMotion: () => true,
    };
});
jest.mock("../src/api/scheduleSharing", () => ({
    createCategoryShare: jest.fn(),
    createCategoryShareInvitation: jest.fn(),
    createScheduleShare: jest.fn(),
    createScheduleShareInvitation: jest.fn(),
    getCategoryShareInvitations: jest.fn(),
    getScheduleShareInvitations: jest.fn(),
    revokeCategoryShareInvitation: jest.fn(),
    revokeScheduleShareInvitation: jest.fn(),
}));
jest.mock("../src/ui/BrandedLoader", () => ({
    __esModule: true,
    default: "BrandedLoader",
}));

const mockGetInvitations = getScheduleShareInvitations as jest.MockedFunction<
    typeof getScheduleShareInvitations
>;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => { resolve = next; });
    return { promise, resolve };
}

function invitation(
    id: string,
    resourceId: string,
    acceptedCount: number,
    maxAcceptCount: number,
): ScheduleShareInvitation {
    return {
        id,
        resourceType: "SCHEDULE",
        resourceId,
        ownerMemberId: 1,
        permission: "EDITOR",
        status: "PENDING",
        expiresAt: "2026-07-20T12:00:00+09:00",
        acceptedCount,
        maxAcceptCount,
    };
}

describe("ShareInvitationSheet async resource state", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.clearAllMocks();
    });

    test("이전 일정의 늦은 초대 응답이 새 일정 공유 시트를 덮지 않는다", async () => {
        const first = deferred<ScheduleShareInvitation[]>();
        const second = deferred<ScheduleShareInvitation[]>();
        mockGetInvitations.mockImplementation((resourceId) => (
            resourceId === "schedule-a" ? first.promise : second.promise
        ));

        const renderSheet = (resourceId: string) => (
            <ThemeProvider>
                <ShareInvitationSheet
                    visible
                    resourceType="schedule"
                    resourceId={resourceId}
                    title={resourceId}
                    onClose={jest.fn()}
                />
            </ThemeProvider>
        );

        await act(async () => {
            renderer = TestRenderer.create(renderSheet("schedule-a"));
        });
        await act(async () => {
            renderer!.root.findAll((node) => (
                node.props.accessibilityRole === "tab"
                && typeof node.props.onPress === "function"
            ))[1].props.onPress();
            renderer!.update(renderSheet("schedule-b"));
        });

        await act(async () => {
            second.resolve([invitation("invite-b", "schedule-b", 2, 5)]);
            await second.promise;
        });
        await act(async () => {
            first.resolve([invitation("invite-a", "schedule-a", 1, 1)]);
            await first.promise;
        });

        const textValues = renderer!.root
            .findAllByType(Text)
            .map((node) => React.Children.toArray(node.props.children).join(""));
        expect(textValues.some((value) => value.includes("2/5명 수락"))).toBe(true);
        expect(textValues.some((value) => value.includes("1/1명 수락"))).toBe(false);
    });
});
