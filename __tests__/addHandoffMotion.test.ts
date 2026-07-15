import {
    ADD_HANDOFF_MOTION,
    ADD_MENU_SOURCE,
    lerpAddHandoffValue,
    resolveAddHandoffCloseDuration,
    shouldRestoreAddHandoffToolbar,
} from "../src/modules/schedule/addHandoffMotion";

describe("add menu handoff motion", () => {
    test("네이티브 등록 pill과 RN 카드가 같은 시작 geometry를 사용한다", () => {
        expect(ADD_MENU_SOURCE).toMatchObject({
            nativeWidth: 238,
            nativeHeight: 164,
            nativeRightInset: 8,
            nativeRadius: 26,
        });
    });

    test("빠른 일정과 일정 생성은 같은 열림·닫힘 속도를 공유한다", () => {
        expect(ADD_HANDOFF_MOTION.quickOpenMs).toBe(200);
        expect(ADD_HANDOFF_MOTION.manualOpenMs).toBe(200);
        expect(ADD_HANDOFF_MOTION.closeMs).toBe(190);
        expect(ADD_HANDOFF_MOTION.manualOpenMs).toBe(ADD_HANDOFF_MOTION.quickOpenMs);
        expect(ADD_HANDOFF_MOTION.openBezier).toEqual([0.28, 0.28, 0.22, 1]);
        expect(ADD_HANDOFF_MOTION.closeBezier).toEqual([0.32, 0.32, 0.66, 1]);
        expect(ADD_HANDOFF_MOTION.contentRevealStartProgress).toBeLessThan(
            ADD_HANDOFF_MOTION.contentRevealEndProgress
        );
        expect(ADD_HANDOFF_MOTION.contentRevealEndProgress).toBeLessThan(0.4);
    });

    test("열리는 도중 닫아도 현재 진행 거리만큼 같은 속도로 복귀한다", () => {
        expect(resolveAddHandoffCloseDuration(1)).toBe(ADD_HANDOFF_MOTION.closeMs);
        expect(resolveAddHandoffCloseDuration(0.5)).toBe(95);
        expect(resolveAddHandoffCloseDuration(0.08)).toBe(15);
        expect(resolveAddHandoffCloseDuration(-1)).toBe(0);
        expect(resolveAddHandoffCloseDuration(2)).toBe(ADD_HANDOFF_MOTION.closeMs);
    });

    test("카드 위치와 크기는 중간 정지 구간 없이 연속적으로 이동한다", () => {
        const samples = Array.from({ length: 11 }, (_, index) => (
            lerpAddHandoffValue(238, 390, index / 10)
        ));

        expect(samples[0]).toBe(238);
        expect(samples[10]).toBe(390);
        for (let index = 1; index < samples.length; index += 1) {
            expect(samples[index]).toBeGreaterThan(samples[index - 1]);
        }
        expect(lerpAddHandoffValue(238, 390, -1)).toBe(238);
        expect(lerpAddHandoffValue(238, 390, 2)).toBe(390);
    });

    test("같은 위치에서 소유권을 교환한 뒤 두 폼이 같은 속도로 이동한다", () => {
        expect(ADD_HANDOFF_MOTION.ownershipCrossfadeMs).toBe(72);
        expect(ADD_HANDOFF_MOTION.nativeResetSettleMs).toBeGreaterThanOrEqual(80);
        expect(
            Math.max(ADD_HANDOFF_MOTION.ownershipCrossfadeMs, ADD_HANDOFF_MOTION.quickOpenMs)
        ).toBe(200);
        expect(ADD_HANDOFF_MOTION.toolbarReturnDelayMs).toBe(16);
        expect(ADD_HANDOFF_MOTION.toolbarReturnDurationMs).toBe(96);
        expect(ADD_HANDOFF_MOTION.toolbarParkedOpacity).toBeGreaterThanOrEqual(0.02);
        expect(ADD_HANDOFF_MOTION.toolbarParkedOpacity).toBeLessThanOrEqual(0.05);
        expect(
            ADD_HANDOFF_MOTION.toolbarReturnDelayMs
            + ADD_HANDOFF_MOTION.toolbarReturnDurationMs
        ).toBeLessThan(ADD_HANDOFF_MOTION.closeMs);
        expect(ADD_HANDOFF_MOTION.closeContentFadeEndProgress).toBeGreaterThan(
            ADD_HANDOFF_MOTION.closeContentFadeStartProgress
        );
        expect(ADD_HANDOFF_MOTION.closeContentParkedOpacity).toBeGreaterThan(0);
        expect(ADD_HANDOFF_MOTION.closeContentParkedOpacity).toBeLessThanOrEqual(0.001);
    });

    test("닫기 중반에 전체 RN 카드가 사라져 빈 흰 shell을 남기지 않는다", () => {
        expect(ADD_HANDOFF_MOTION.closeContentFadeStartProgress).toBe(0.42);
        expect(ADD_HANDOFF_MOTION.closeContentFadeEndProgress).toBe(0.70);
        expect(ADD_HANDOFF_MOTION.closeContentFadeEndProgress).toBeLessThan(0.75);
    });

    test("포커스된 일정 화면의 idle 상태에서 우측 pill 복구를 요청한다", () => {
        expect(shouldRestoreAddHandoffToolbar({
            isFocused: true,
            modalVisible: false,
            quickModalVisible: false,
            handoffPending: false,
            handoffClosing: false,
            liquidMenuOpen: false,
        })).toBe(true);

        expect(shouldRestoreAddHandoffToolbar({
            isFocused: true,
            modalVisible: true,
            quickModalVisible: false,
            handoffPending: false,
            handoffClosing: false,
            liquidMenuOpen: false,
        })).toBe(false);

        expect(shouldRestoreAddHandoffToolbar({
            isFocused: false,
            modalVisible: false,
            quickModalVisible: false,
            handoffPending: false,
            handoffClosing: false,
            liquidMenuOpen: false,
        })).toBe(false);

        expect(shouldRestoreAddHandoffToolbar({
            isFocused: true,
            modalVisible: false,
            quickModalVisible: false,
            handoffPending: true,
            handoffClosing: false,
            liquidMenuOpen: true,
        })).toBe(false);

        expect(shouldRestoreAddHandoffToolbar({
            isFocused: true,
            modalVisible: false,
            quickModalVisible: false,
            handoffPending: false,
            handoffClosing: true,
            liquidMenuOpen: false,
        })).toBe(false);
    });
});
