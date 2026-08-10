import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { useLocalSearchParams } from "expo-router";

import ScheduleCategoriesScreen from "../app/schedule/categories";
import {
    createScheduleCategoryToApi,
    getScheduleCategoriesFromApi,
} from "../src/api/scheduleCategories";
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
        mockUseLocalSearchParams.mockReturnValue({});
    });

    async function renderScreen() {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleProvider initialState={createScheduleInitialState(new Date(2026, 6, 17))}>
                        <ScheduleCategoriesScreen />
                    </ScheduleProvider>
                </ThemeProvider>
            );
            await Promise.resolve();
            await Promise.resolve();
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
});
