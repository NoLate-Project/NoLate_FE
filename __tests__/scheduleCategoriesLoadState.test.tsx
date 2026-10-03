import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { useLocalSearchParams } from "expo-router";

import ScheduleCategoriesScreen from "../app/schedule/categories";
import {
    createScheduleCategoryToApi,
    getScheduleCategoriesFromApi,
} from "../src/api/scheduleCategories";
import { getScheduleCalendars } from "../src/api/scheduleCalendars";
import { createScheduleInitialState } from "../src/modules/schedule/initialState";
import { ScheduleProvider } from "../src/modules/schedule/store";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("../src/modules/auth/authStorage", () => ({
    subscribeAuthInvalidation: () => () => undefined,
}));
jest.mock("expo-router", () => ({
    useLocalSearchParams: jest.fn(() => ({})),
    useRouter: () => ({
        back: jest.fn(),
        canGoBack: () => true,
        replace: jest.fn(),
    }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/api/scheduleCategories", () => ({
    createScheduleCategoryToApi: jest.fn(),
    deleteScheduleCategoryFromApi: jest.fn(),
    getScheduleCategoriesFromApi: jest.fn(),
    updateScheduleCategoryToApi: jest.fn(),
}));
jest.mock("../src/api/scheduleCalendars", () => ({
    getScheduleCalendars: jest.fn(() => Promise.resolve([])),
}));
jest.mock("../src/modules/schedule/components/share/ShareInvitationSheet", () => "ShareInvitationSheet");
jest.mock("../src/ui/BrandedLoader", () => ({
    __esModule: true,
    default: "BrandedLoader",
}));

const mockGetCategories = getScheduleCategoriesFromApi as jest.MockedFunction<
    typeof getScheduleCategoriesFromApi
>;
const mockCreateCategory = createScheduleCategoryToApi as jest.MockedFunction<
    typeof createScheduleCategoryToApi
>;
const mockGetCalendars = getScheduleCalendars as jest.MockedFunction<typeof getScheduleCalendars>;
const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<
    typeof useLocalSearchParams
>;

describe("ScheduleCategoriesScreen load state", () => {
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
        mockGetCalendars.mockResolvedValue([]);
        mockUseLocalSearchParams.mockReturnValue({});
    });

    async function renderScreen(initialCategories: ReturnType<typeof createScheduleInitialState>["categories"] = []) {
        const initialState = createScheduleInitialState(new Date(2026, 6, 17));
        initialState.categories = initialCategories;
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleProvider initialState={initialState}>
                        <ScheduleCategoriesScreen />
                    </ScheduleProvider>
                </ThemeProvider>
            );
            await Promise.resolve();
            await Promise.resolve();
        });
        // InteractionManager callback and the two independent category/calendar
        // requests can settle on separate turns when the full suite is running.
        await act(async () => {
            await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
        });
    }

    test("조회 실패를 빈 목록으로 오해시키지 않고 재시도를 제공한다", async () => {
        mockGetCategories.mockRejectedValueOnce(new Error("네트워크 오류"));
        await renderScreen();

        expect(renderer!.root.findByProps({ accessibilityRole: "alert" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ children: "카테고리가 없어요" })).toHaveLength(0);

        mockGetCategories.mockResolvedValueOnce([]);
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "카테고리 다시 불러오기" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockGetCategories).toHaveBeenCalledTimes(2);
        expect(renderer!.root.findByProps({ children: "카테고리가 없어요" })).toBeDefined();
    });

    test("추가 버튼을 빠르게 연속으로 눌러도 카테고리는 한 번만 생성한다", async () => {
        mockGetCategories.mockResolvedValueOnce([]);
        let resolveCreate!: (value: {
            id: string;
            title: string;
            color: string;
        }) => void;
        mockCreateCategory.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCreate = resolve;
        }));
        await renderScreen();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 이름" })
                .props.onChangeText("운동");
        });
        const addButton = renderer!.root.findByProps({ accessibilityLabel: "카테고리 추가" });
        await act(async () => {
            addButton.props.onPress();
            addButton.props.onPress();
            await Promise.resolve();
        });

        expect(mockCreateCategory).toHaveBeenCalledTimes(1);
        await act(async () => {
            resolveCreate({ id: "exercise", title: "운동", color: "#ff3b30" });
            await Promise.resolve();
        });
    });

    test("카테고리 이름은 iOS 자동 완성이나 보안 입력으로 분류하지 않는다", async () => {
        mockGetCategories.mockResolvedValueOnce([]);
        await renderScreen();

        const input = renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 이름" });
        expect(input.props.secureTextEntry).toBe(false);
        expect(input.props.textContentType).toBe("none");
        expect(input.props.autoComplete).toBe("off");
    });

    test("공유 캘린더 카테고리 생성은 캘린더 id를 전달하고 생성 결과를 목록에 표시한다", async () => {
        mockUseLocalSearchParams.mockReturnValue({
            calendarId: "16",
            calendarTitle: "A E2E Shared",
        });
        mockGetCategories.mockResolvedValueOnce([]);
        mockGetCalendars.mockResolvedValueOnce([{
            id: 16,
            title: "A E2E Shared",
            color: "#2F80FF",
            defaultContentMode: "SCHEDULE_ONLY",
            status: "ACTIVE",
            ownerMemberId: 1,
            myRole: "OWNER",
            memberCount: 2,
            routeReminderEnabled: true,
        }]);
        mockCreateCategory.mockResolvedValueOnce({
            id: "101",
            title: "Owner Cat",
            color: "#ff3b30",
            calendarId: 16,
            shared: true,
            sharePermission: "OWNER",
        });
        await renderScreen();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 이름" })
                .props.onChangeText("Owner Cat");
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 추가" })
                .props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockCreateCategory).toHaveBeenCalledWith("Owner Cat", "#ff3b30", undefined, 16);
        expect(renderer!.root.findByProps({ children: "Owner Cat" })).toBeDefined();
    });

    test("공유 캘린더 권한 조회 중에는 권한 없음 빈 상태를 표시하지 않는다", async () => {
        mockUseLocalSearchParams.mockReturnValue({
            calendarId: "16",
            calendarTitle: "가족",
        });
        const cachedPersonalCategory = {
            id: "personal",
            title: "개인",
            color: "#ff3b30",
        };
        mockGetCategories.mockResolvedValueOnce([cachedPersonalCategory]);
        let resolveCalendars!: (calendars: Awaited<ReturnType<typeof getScheduleCalendars>>) => void;
        mockGetCalendars.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCalendars = resolve;
        }));

        await renderScreen([cachedPersonalCategory]);

        expect(renderer!.root.findAllByProps({
            children: "이 캘린더의 카테고리를 관리할 권한이 없어요.",
        })).toHaveLength(0);
        expect(renderer!.root.findByProps({
            accessibilityLabel: "카테고리를 불러오고 있어요",
        })).toBeDefined();

        await act(async () => {
            resolveCalendars([{
                id: 16,
                title: "가족",
                color: "#2F80FF",
                defaultContentMode: "SCHEDULE_ONLY",
                status: "ACTIVE",
                ownerMemberId: 1,
                myRole: "OWNER",
                memberCount: 1,
                routeReminderEnabled: true,
            }]);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 이름" })).toBeDefined();
        expect(renderer!.root.findAllByProps({
            children: "이 캘린더의 카테고리를 관리할 권한이 없어요.",
        })).toHaveLength(0);
    });

    test("공유 캘린더 VIEWER에게는 카테고리 생성·메타데이터 관리를 노출하지 않는다", async () => {
        mockUseLocalSearchParams.mockReturnValue({
            calendarId: "16",
            calendarTitle: "가족",
        });
        mockGetCategories.mockResolvedValueOnce([{
            id: "viewer-category",
            title: "가족 행사",
            color: "#ff3b30",
            calendarId: 16,
            shared: true,
            sharePermission: "VIEWER",
            canManageMetadata: false,
            canManageAudience: false,
        }]);
        mockGetCalendars.mockResolvedValueOnce([{
            id: 16,
            title: "가족",
            color: "#2F80FF",
            defaultContentMode: "SCHEDULE_ONLY",
            status: "ACTIVE",
            ownerMemberId: 1,
            myRole: "VIEWER",
            memberCount: 2,
            routeReminderEnabled: true,
        }]);
        await renderScreen();

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "새 카테고리 이름" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "가족 행사 수정" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "가족 행사 삭제" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "가족 행사 카테고리 작업 메뉴" })).toHaveLength(0);
    });

    test("이동된 직접 공유 카테고리에 이전 캘린더 EDITOR 역할을 적용하지 않는다", async () => {
        mockGetCategories.mockResolvedValueOnce([{
            id: "moved-direct-category",
            title: "이동된 프로젝트",
            color: "#007aff",
            calendarId: 22,
            shared: true,
            sharePermission: "EDITOR",
            // A stale category response may still carry its old calendar capability. The
            // membership for this category's current calendar remains the final UI fence.
            canManageMetadata: true,
            canManageAudience: true,
        }]);
        mockGetCalendars.mockResolvedValueOnce([{
            id: 16,
            title: "이전 캘린더",
            color: "#2F80FF",
            defaultContentMode: "SCHEDULE_ONLY",
            status: "ACTIVE",
            ownerMemberId: 1,
            myRole: "EDITOR",
            memberCount: 2,
            routeReminderEnabled: true,
        }]);
        await renderScreen();

        expect(renderer!.root.findByProps({ children: "이동된 프로젝트" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "이동된 프로젝트 수정" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "이동된 프로젝트 삭제" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "이동된 프로젝트 카테고리 작업 메뉴",
        })).toHaveLength(0);
    });

    test("캐시된 이전 캘린더 카테고리는 최신 범위를 확인하기 전 수정할 수 없다", async () => {
        mockUseLocalSearchParams.mockReturnValue({
            calendarId: "16",
            calendarTitle: "이전 캘린더",
        });
        const cachedCategory = {
            id: "moving-category",
            title: "이동 중인 프로젝트",
            color: "#007aff",
            calendarId: 16,
            shared: true,
            sharePermission: "EDITOR" as const,
            canManageMetadata: true,
            canManageAudience: false,
        };
        let resolveCategories!: (categories: typeof cachedCategory[]) => void;
        mockGetCategories.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCategories = resolve;
        }));
        mockGetCalendars.mockResolvedValueOnce([{
            id: 16,
            title: "이전 캘린더",
            color: "#2F80FF",
            defaultContentMode: "SCHEDULE_ONLY",
            status: "ACTIVE",
            ownerMemberId: 1,
            myRole: "EDITOR",
            memberCount: 2,
            routeReminderEnabled: true,
        }]);
        await renderScreen([cachedCategory]);

        expect(renderer!.root.findByProps({ children: "이동 중인 프로젝트" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "이동 중인 프로젝트 수정" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "이동 중인 프로젝트 삭제" })).toHaveLength(0);

        await act(async () => {
            resolveCategories([{ ...cachedCategory, calendarId: 22, canManageMetadata: false }]);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(renderer!.root.findAllByProps({ children: "이동 중인 프로젝트" })).toHaveLength(0);
    });

    test("개인 소유 카테고리에만 다른 캘린더 이동 액션을 표시한다", async () => {
        mockGetCategories.mockResolvedValueOnce([
            {
                id: "owned",
                title: "업무",
                color: "#ff3b30",
                ownerMemberId: 10,
            },
            {
                id: "received",
                title: "친구 일정",
                color: "#007aff",
                shared: true,
                sharePermission: "EDITOR",
            },
        ]);
        await renderScreen();

        expect(renderer!.root.findByProps({
            accessibilityLabel: "업무 카테고리 작업 메뉴",
        })).toBeDefined();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "업무 공유" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "업무 수정" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "업무 삭제" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "친구 일정 카테고리 작업 메뉴",
        })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "친구 일정 수정" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "친구 일정 삭제" })).toHaveLength(0);
    });

    test("공유 캘린더 OWNER는 카테고리 공유·이동 메뉴를 본다", async () => {
        mockUseLocalSearchParams.mockReturnValue({
            calendarId: "16",
            calendarTitle: "가족",
        });
        mockGetCategories.mockResolvedValueOnce([
            {
                id: "owner-category",
                title: "가족 행사",
                color: "#ff3b30",
                calendarId: 16,
                shared: true,
                sharePermission: "OWNER",
            },
        ]);
        mockGetCalendars.mockResolvedValueOnce([
            {
                id: 16,
                title: "가족",
                color: "#2F80FF",
                defaultContentMode: "SCHEDULE_ONLY",
                status: "ACTIVE",
                ownerMemberId: 1,
                myRole: "OWNER",
                memberCount: 2,
                routeReminderEnabled: true,
            },
        ]);
        await renderScreen();

        expect(renderer!.root.findByProps({
            accessibilityLabel: "가족 행사 카테고리 작업 메뉴",
        })).toBeDefined();
    });

    test("공유 캘린더 EDITOR는 카테고리 메타데이터를 편집하지만 공유·이동은 관리하지 않는다", async () => {
        mockUseLocalSearchParams.mockReturnValue({
            calendarId: "16",
            calendarTitle: "가족",
        });
        mockGetCategories.mockResolvedValueOnce([{
            id: "editor-category",
            title: "장보기",
            color: "#007aff",
            calendarId: 16,
            shared: true,
            sharePermission: "EDITOR",
        }]);
        mockGetCalendars.mockResolvedValueOnce([{
            id: 16,
            title: "가족",
            color: "#2F80FF",
            defaultContentMode: "SCHEDULE_ONLY",
            status: "ACTIVE",
            ownerMemberId: 2,
            myRole: "EDITOR",
            memberCount: 2,
            routeReminderEnabled: true,
        }]);
        await renderScreen();

        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "장보기 카테고리 작업 메뉴",
        })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "장보기 수정" })).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "장보기 삭제" })).toBeDefined();
    });
});
