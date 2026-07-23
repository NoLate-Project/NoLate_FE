import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    ShareInboxButton,
    ShareInboxDecoration,
} from "../src/modules/share/ShareInboxAccessibility";

describe("share inbox accessibility primitives", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    test("일정 열기와 공유 대상 관리 동작을 모두 button으로 고정한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <>
                    <ShareInboxButton accessibilityLabel="테스트 일정 열기">
                        <Text>일정 열기</Text>
                    </ShareInboxButton>
                    <ShareInboxButton accessibilityLabel="테스트 일정 공유 대상 관리">
                        <Text>공유 대상 관리</Text>
                    </ShareInboxButton>
                </>,
            );
        });

        const buttons = renderer!.root.findAll((node) => (
            node.props?.accessible === true
            && node.props.role === "button"
            && node.props.accessibilityRole === "button"
        ));
        const buttonLabels = [...new Set(
            buttons.map((button) => button.props.accessibilityLabel),
        )];

        expect(buttonLabels).toEqual([
            "테스트 일정 열기",
            "테스트 일정 공유 대상 관리",
        ]);
    });

    test("빈 상태와 카드 내부의 장식 아이콘·문자를 접근성 트리에서 숨긴다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ShareInboxDecoration>
                    <Text></Text>
                </ShareInboxDecoration>,
            );
        });

        const hiddenGroups = renderer!.root.findAll((node) => (
            node.props?.accessible === false
            && node.props.accessibilityElementsHidden === true
            && node.props.importantForAccessibility === "no-hide-descendants"
        ));

        expect(hiddenGroups.length).toBeGreaterThanOrEqual(1);
    });
});
