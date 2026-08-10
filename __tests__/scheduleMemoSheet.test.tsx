import React from "react";
import { Modal, StyleSheet, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { useReducedMotion } from "react-native-reanimated";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

import ScheduleMemoSheet, {
    shouldDismissScheduleMemoSheet,
} from "../src/modules/schedule/components/detail/ScheduleMemoSheet";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

describe("ScheduleMemoSheet", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeEach(() => {
        jest.mocked(useReducedMotion).mockReturnValue(false);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    async function renderSheet({
        onClose = jest.fn(),
        onEdit,
    }: {
        onClose?: jest.Mock;
        onEdit?: jest.Mock;
    } = {}) {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleMemoSheet
                        visible
                        title="신은비·김현섭 본식스냅"
                        notes={" 예약자/신부: 신은비\n연락처: 010-1234-5678 "}
                        bottomInset={24}
                        onEdit={onEdit}
                        onClose={onClose}
                    />
                </ThemeProvider>
            );
        });
        return { onClose, onEdit };
    }

    test("긴 메모를 읽고 선택할 수 있는 별도 시트를 표시한다", async () => {
        await renderSheet();

        const modal = renderer!.root.findByType(Modal);
        const memo = renderer!.root.findByProps({ testID: "schedule-memo-text" });
        const text = renderer!.root
            .findAllByType(Text)
            .map((node) => node.props.children)
            .flat(Infinity)
            .filter((value) => typeof value === "string")
            .join(" ");

        expect(modal.props.visible).toBe(true);
        expect(text).toContain("메모");
        expect(text).toContain("신은비·김현섭 본식스냅");
        expect(memo.props.children).toBe("예약자/신부: 신은비\n연락처: 010-1234-5678");
        expect(memo.props.selectable).toBe(true);
    });

    test("배경 화면은 색상이나 블러 없이 그대로 보이게 유지한다", async () => {
        await renderSheet();

        const modal = renderer!.root.findByType(Modal);
        const backdrop = renderer!.root.findByProps({ testID: "schedule-memo-sheet" });
        const outsideTapArea = renderer!.root.findByProps({ testID: "schedule-memo-backdrop" });

        expect(modal.props.transparent).toBe(true);
        expect(modal.props.presentationStyle).toBe("overFullScreen");
        expect(StyleSheet.flatten(backdrop.props.style).backgroundColor).toBe("transparent");
        expect(outsideTapArea.props.accessible).toBe(false);
        expect(outsideTapArea.props.importantForAccessibility).toBe("no");
    });

    test("동작 줄이기 설정에서는 시트 등장 애니메이션을 생략한다", async () => {
        jest.mocked(useReducedMotion).mockReturnValue(true);
        await renderSheet();

        expect(renderer!.root.findByType(Modal).props.animationType).toBe("none");
    });

    test("닫기 버튼·배경·시스템 뒤로 가기가 모두 시트를 닫는다", async () => {
        const { onClose } = await renderSheet();

        await act(async () => renderer!.root.findByProps({
            testID: "schedule-memo-close",
        }).props.onPress());
        await act(async () => renderer!.root.findByProps({
            testID: "schedule-memo-backdrop",
        }).props.onPress());
        await act(async () => renderer!.root.findByType(Modal).props.onRequestClose());

        expect(onClose).toHaveBeenCalledTimes(3);
    });

    test("핸들은 아래 방향 제스처를 받고 거리나 속도가 충분할 때 닫힌다", async () => {
        await renderSheet();
        const handle = renderer!.root.findByProps({ testID: "schedule-memo-handle" });

        expect(handle.props.onStartShouldSetResponder()).toBe(true);
        expect(typeof handle.props.onResponderMove).toBe("function");
        expect(typeof handle.props.onResponderRelease).toBe("function");
        expect(shouldDismissScheduleMemoSheet(63, 0.74)).toBe(false);
        expect(shouldDismissScheduleMemoSheet(64, 0)).toBe(true);
        expect(shouldDismissScheduleMemoSheet(0, 0.75)).toBe(true);
    });

    test("편집 권한이 있을 때만 메모 수정 진입 버튼을 표시한다", async () => {
        const onEdit = jest.fn();
        await renderSheet({ onEdit });

        await act(async () => renderer!.root.findByProps({
            testID: "schedule-memo-edit",
        }).props.onPress());

        expect(onEdit).toHaveBeenCalledTimes(1);

        await act(async () => renderer!.update(
            <ThemeProvider>
                <ScheduleMemoSheet
                    visible
                    title="보기 전용 일정"
                    notes="메모"
                    bottomInset={24}
                    onClose={jest.fn()}
                />
            </ThemeProvider>
        ));

        expect(renderer!.root.findAllByProps({ testID: "schedule-memo-edit" })).toHaveLength(0);
    });

    test("헤더 동작은 44포인트 터치 영역과 명확한 접근성 이름을 제공한다", async () => {
        await renderSheet({ onEdit: jest.fn() });

        const edit = renderer!.root.findByProps({ testID: "schedule-memo-edit" });
        const close = renderer!.root.findByProps({ testID: "schedule-memo-close" });
        const editStyle = StyleSheet.flatten(edit.props.style({ pressed: false }));
        const closeStyle = StyleSheet.flatten(close.props.style({ pressed: false }));

        expect(edit.props.accessibilityLabel).toBe("메모 수정");
        expect(close.props.accessibilityLabel).toBe("메모 닫기");
        expect(editStyle.height).toBe(44);
        expect(closeStyle.width).toBe(44);
        expect(closeStyle.height).toBe(44);
    });
});
