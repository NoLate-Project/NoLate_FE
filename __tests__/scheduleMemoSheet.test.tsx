import React from "react";
import { Modal, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

import ScheduleMemoSheet from "../src/modules/schedule/components/detail/ScheduleMemoSheet";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

describe("ScheduleMemoSheet", () => {
    let renderer: ReactTestRenderer | undefined;

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
        expect(text).toContain("일정 메모");
        expect(text).toContain("신은비·김현섭 본식스냅");
        expect(memo.props.children).toBe("예약자/신부: 신은비\n연락처: 010-1234-5678");
        expect(memo.props.selectable).toBe(true);
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
});
