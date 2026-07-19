import React from "react";
import { Alert } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { createScheduleCategoryToApi } from "../src/api/scheduleCategories";
import CalendarImportCategoryCreator from "../src/modules/onboarding/CalendarImportCategoryCreator";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("../src/api/scheduleCategories", () => ({
    createScheduleCategoryToApi: jest.fn(),
}));

const mockCreateCategory = createScheduleCategoryToApi as jest.MockedFunction<
    typeof createScheduleCategoryToApi
>;

describe("CalendarImportCategoryCreator", () => {
    let renderer: ReactTestRenderer | undefined;
    let alertSpy: jest.SpyInstance;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        alertSpy.mockRestore();
        jest.clearAllMocks();
    });

    async function renderCreator({
        categoryCount = 0,
        onBusyChange = jest.fn(),
        onCreated = jest.fn(),
    }: {
        categoryCount?: number;
        onBusyChange?: jest.Mock;
        onCreated?: jest.Mock;
    } = {}) {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <CalendarImportCategoryCreator
                        categoryCount={categoryCount}
                        onBusyChange={onBusyChange}
                        onCreated={onCreated}
                    />
                </ThemeProvider>
            );
        });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 추가" })
                .props.onPress();
        });

        return { onBusyChange, onCreated };
    }

    async function enterTitle(title: string) {
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 이름" })
                .props.onChangeText(title);
        });
    }

    test("이름을 정리하고 선택한 색상으로 생성한 뒤 새 카테고리를 전달하고 폼을 닫는다", async () => {
        const created = { id: "exercise", title: "운동", color: "#af52de" };
        mockCreateCategory.mockResolvedValueOnce(created);
        const { onBusyChange, onCreated } = await renderCreator({ categoryCount: 2 });

        await enterTitle("  운동  ");
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "보라 색상" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(mockCreateCategory).toHaveBeenCalledTimes(1);
        expect(mockCreateCategory).toHaveBeenCalledWith("운동", "#af52de");
        expect(onCreated).toHaveBeenCalledTimes(1);
        expect(onCreated).toHaveBeenCalledWith(created);
        expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "새 카테고리 이름" }))
            .toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 추가" }))
            .toBeDefined();
    });

    test("생성 요청 중 빠른 중복 탭을 한 번만 처리하고 busy 상태를 알린다", async () => {
        const created = { id: "family", title: "가족", color: "#ff3b30" };
        let resolveCreate!: (category: typeof created) => void;
        mockCreateCategory.mockImplementationOnce(() => new Promise((resolve) => {
            resolveCreate = resolve;
        }));
        const { onBusyChange, onCreated } = await renderCreator();
        await enterTitle("가족");

        const createButton = renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" });
        await act(async () => {
            createButton.props.onPress();
            createButton.props.onPress();
            await Promise.resolve();
        });

        expect(mockCreateCategory).toHaveBeenCalledTimes(1);
        expect(onBusyChange).toHaveBeenCalledTimes(1);
        expect(onBusyChange).toHaveBeenLastCalledWith(true);
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" })
            .props.accessibilityState).toEqual({ busy: true, disabled: true });

        await act(async () => {
            resolveCreate(created);
            await Promise.resolve();
        });

        expect(onCreated).toHaveBeenCalledWith(created);
        expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    });

    test("생성 실패를 알리고 입력을 유지해 같은 값으로 재시도할 수 있다", async () => {
        const created = { id: "side-project", title: "사이드 프로젝트", color: "#ff9500" };
        mockCreateCategory
            .mockRejectedValueOnce(new Error("네트워크 오류"))
            .mockResolvedValueOnce(created);
        const { onBusyChange, onCreated } = await renderCreator({ categoryCount: 1 });
        await enterTitle("  사이드 프로젝트  ");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(alertSpy).toHaveBeenCalledWith("카테고리 추가 실패", "네트워크 오류");
        expect(onCreated).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 이름" })
            .props.value).toBe("  사이드 프로젝트  ");
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" })
            .props.accessibilityState).toEqual({ busy: false, disabled: false });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(mockCreateCategory).toHaveBeenCalledTimes(2);
        expect(mockCreateCategory).toHaveBeenNthCalledWith(1, "사이드 프로젝트", "#ff9500");
        expect(mockCreateCategory).toHaveBeenNthCalledWith(2, "사이드 프로젝트", "#ff9500");
        expect(onCreated).toHaveBeenCalledTimes(1);
        expect(onCreated).toHaveBeenCalledWith(created);
        expect(onBusyChange.mock.calls).toEqual([[true], [false], [true], [false]]);
    });

    test("API가 빈 id를 반환하면 생성 성공으로 전달하지 않는다", async () => {
        mockCreateCategory.mockResolvedValueOnce({
            id: "   ",
            title: "운동",
            color: "#ff3b30",
        });
        const { onCreated } = await renderCreator();
        await enterTitle("운동");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(mockCreateCategory).toHaveBeenCalledTimes(1);
        expect(onCreated).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            "카테고리 추가 실패",
            "추가된 카테고리를 확인하지 못했어요. 다시 시도해 주세요."
        );
        expect(renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 이름" })
            .props.value).toBe("운동");
    });

    test("API가 쓰기 불가 카테고리를 반환하면 생성 성공으로 전달하지 않는다", async () => {
        mockCreateCategory.mockResolvedValueOnce({
            id: "shared-viewer",
            title: "받은 일정",
            color: "#ff3b30",
            shared: true,
            sharePermission: "VIEWER",
        });
        const { onCreated } = await renderCreator();
        await enterTitle("받은 일정");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" })
                .props.onPress();
            await Promise.resolve();
        });

        expect(onCreated).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            "카테고리 추가 실패",
            "추가된 카테고리를 확인하지 못했어요. 다시 시도해 주세요."
        );
        expect(renderer!.root.findByProps({ accessibilityLabel: "새 카테고리 이름" })
            .props.value).toBe("받은 일정");
    });

    test("공백 이름은 생성 API를 호출하지 않는다", async () => {
        const { onBusyChange, onCreated } = await renderCreator();
        await enterTitle("   ");

        const createButton = renderer!.root.findByProps({ accessibilityLabel: "카테고리 만들기" });
        expect(createButton.props.accessibilityState).toEqual({ busy: false, disabled: true });
        await act(async () => {
            createButton.props.onPress();
            await Promise.resolve();
        });

        expect(mockCreateCategory).not.toHaveBeenCalled();
        expect(onCreated).not.toHaveBeenCalled();
        expect(onBusyChange).not.toHaveBeenCalled();
    });
});
