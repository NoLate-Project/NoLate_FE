import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import JourneyRouteQualityRoute from "../app/internal/journey-route-quality";
import type { JourneyRouteAssessmentResult } from "../src/modules/journey/journeyRouteAssessment";
import { journeyRouteFixtures } from "../src/modules/journey/journeyRouteFixtures";

const mockAssess = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock("../src/modules/journey/journeyRouteAssessment", () => ({
    assessJourneyRouteInput: (input: unknown) => mockAssess(input),
}), { virtual: true });
jest.mock("../src/modules/journey/journeyRouteFixtures", () => ({
    journeyRouteFixtures: [
        "direct-provider-shape", "stop-line-fallback", "missing-stop-order",
        "wrong-direction-shape", "saved-legacy", "invalid-middle-coordinate",
    ].map(id => ({ id, title: id, description: `${id} 예시 설명`, input: { fixture: id } })),
}), { virtual: true });
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("expo-router", () => ({
    Redirect: "Redirect",
    useRouter: () => ({ canGoBack: mockCanGoBack, replace: mockReplace, back: mockBack }),
}));

const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalDev = runtime.__DEV__;
const available: JourneyRouteAssessmentResult = {
    available: true,
    summary: {
        schemaVersion: 1, routeRevision: 7, context: "SYNTHETIC_FIXTURE", provider: "tmap",
        evaluationMode: "READ_ONLY", fullAutomaticGuidance: false, fieldValidated: false,
        eligibleDepartureLegIndex: 0, reasonCodes: ["FIELD_VALIDATION_REQUIRED"],
        legs: [{
            index: 0, kind: "BUS", geometryUsable: true, stopSequenceUsable: true,
            directionExplicit: true, rideNavigationEligible: false,
            geometryLengthMeters: 234.5, shapePointCount: 3, stopCount: 2, reasonCodes: ["SYNTHETIC_INPUT"],
        }],
    },
};
const deferred = () => {
    let resolve!: (result: JourneyRouteAssessmentResult) => void;
    const promise = new Promise<JourneyRouteAssessmentResult>(next => { resolve = next; });
    return { promise, resolve };
};

describe("P1-2 route quality screen", () => {
    let renderer: ReactTestRenderer | undefined;
    beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
    beforeEach(() => {
        jest.clearAllMocks();
        runtime.__DEV__ = true;
        mockAssess.mockResolvedValue(available);
        mockCanGoBack.mockReturnValue(false);
    });
    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        runtime.__DEV__ = originalDev;
    });
    const render = async () => {
        await act(async () => { renderer = TestRenderer.create(<JourneyRouteQualityRoute />); });
        return renderer!;
    };
    const press = async (screen: ReactTestRenderer, id: string) => {
        await act(async () => screen.root.findByProps({ testID: id }).props.onPress());
    };
    const fixtureButton = (index: number) => `route-quality-fixture-${journeyRouteFixtures[index].id}`;

    it("mounts six selectable fixtures without assessing or starting navigation", async () => {
        const screen = await render();
        expect(mockAssess).not.toHaveBeenCalled();
        for (let index = 0; index < 6; index++) {
            expect(screen.root.findByProps({ testID: fixtureButton(index) })).toBeTruthy();
        }
        expect(screen.root.findByProps({ testID: fixtureButton(0) }).props.accessibilityState).toEqual({ selected: true });
        expect(screen.root.findByProps({ testID: "route-quality-guidance-state" }).props.children).toBe("자동 길안내 OFF");
        expect(screen.root.findAllByProps({ testID: "route-quality-result" })).toHaveLength(0);
        const text = JSON.stringify(screen.toJSON());
        expect(text).toContain("API 요청·위치 추적·일정 변경은 없습니다");
        expect(text).toContain("실주행 미검증");
    });

    it("selecting a fixture is read-only until the explicit assessment action", async () => {
        const screen = await render();
        await press(screen, fixtureButton(1));
        expect(mockAssess).not.toHaveBeenCalled();
        expect(screen.root.findByProps({ testID: fixtureButton(1) }).props.accessibilityState).toEqual({ selected: true });
        expect(screen.root.findByProps({ testID: "route-quality-fixture-description" }).props.children).toBe(journeyRouteFixtures[1].description);
        await press(screen, "route-quality-assess");
        expect(mockAssess).toHaveBeenCalledTimes(1);
        expect(mockAssess).toHaveBeenCalledWith(journeyRouteFixtures[1].input);
    });

    it("shows shape and preserved-stop counts with provenance and no navigation-ready claim", async () => {
        const screen = await render();
        await press(screen, "route-quality-assess");
        expect(screen.root.findByProps({ testID: "route-quality-status" }).props.children).toBe("검사 완료 · 자동 길안내 OFF");
        expect(screen.root.findByProps({ testID: "route-quality-source" }).props.children.join("")).toBe("출처: tmap · SYNTHETIC_FIXTURE");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-geometry" }).props.children).toBe("형상 검사 통과");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-reasons" }).props.children).toBe("SYNTHETIC_INPUT");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-counts" }).props.children.join("")).toBe("형상점 3개 · 보존 정류장 2개");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-length" }).props.children.join("")).toBe("형상 길이: 234.5 m");
        expect(JSON.stringify(screen.toJSON())).not.toContain("자동 길안내 가능");
    });

    it("clears previous results immediately when selecting another fixture", async () => {
        const screen = await render();
        await press(screen, "route-quality-assess");
        await press(screen, fixtureButton(4));
        expect(screen.root.findAllByProps({ testID: "route-quality-result" })).toHaveLength(0);
        expect(screen.root.findByProps({ testID: "route-quality-status" }).props.children).toBe("예시 선택 후 검사를 눌러 주세요");
        expect(mockAssess).toHaveBeenCalledTimes(1);
    });

    it("shows missing shape, length and stop ordering as needing correction", async () => {
        if (!available.available) throw new Error("Invalid test fixture");
        mockAssess.mockResolvedValue({ ...available, summary: { ...available.summary, legs: [{
            ...available.summary.legs[0], geometryUsable: false, geometryLengthMeters: null,
            stopSequenceUsable: false, directionExplicit: false, reasonCodes: ["STOP_SEQUENCE_MISSING"],
        }] } });
        const screen = await render();
        await press(screen, "route-quality-assess");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-geometry" }).props.children).toBe("형상 보완 필요");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-length" }).props.children.join("")).toBe("형상 길이: 확인 불가");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-reasons" }).props.children).toBe("STOP_SEQUENCE_MISSING");
        expect(screen.root.findByProps({ testID: "route-quality-guidance-state" }).props.children).toBe("자동 길안내 OFF");
    });

    it("shows stop ordering and direction as not applicable to walking rather than deficient", async () => {
        if (!available.available) throw new Error("Invalid test fixture");
        mockAssess.mockResolvedValue({ ...available, summary: { ...available.summary, legs: [{
            ...available.summary.legs[0], kind: "WALK", stopSequenceUsable: false, directionExplicit: false, reasonCodes: [],
        }] } });
        const screen = await render();
        await press(screen, "route-quality-assess");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-stop-applicability" }).props.children).toBe("정류장 순서·방향: 도보 구간 해당 없음");
        expect(screen.root.findByProps({ testID: "route-quality-leg-0-geometry" }).props.children).toBe("형상 검사 통과");
    });

    it("ignores a late result after a selection change", async () => {
        const old = deferred();
        mockAssess.mockReturnValueOnce(old.promise);
        const screen = await render();
        await press(screen, "route-quality-assess");
        expect(screen.root.findByProps({ testID: "route-quality-assess" }).props.disabled).toBe(true);
        await press(screen, fixtureButton(2));
        expect(screen.root.findByProps({ testID: "route-quality-assess" }).props.disabled).toBe(false);
        await act(async () => old.resolve(available));
        expect(screen.root.findAllByProps({ testID: "route-quality-result" })).toHaveLength(0);
        expect(screen.root.findByProps({ testID: "route-quality-status" }).props.children).toBe("예시 선택 후 검사를 눌러 주세요");
    });

    it("does not let an older request complete or clear a newer pending request", async () => {
        const old = deferred();
        const latest = deferred();
        mockAssess.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
        const screen = await render();
        await press(screen, "route-quality-assess");
        await press(screen, fixtureButton(3));
        await press(screen, "route-quality-assess");
        await act(async () => old.resolve(available));
        expect(screen.root.findByProps({ testID: "route-quality-status" }).props.children).toBe("검사 중");
        expect(screen.root.findByProps({ testID: "route-quality-assess" }).props.disabled).toBe(true);
        await act(async () => latest.resolve({ available: false, reason: "INVALID_ROUTE_INPUT" }));
        expect(screen.root.findByProps({ testID: "route-quality-status" }).props.children).toBe("검사 불가");
        expect(screen.root.findAllByProps({ testID: "route-quality-result" })).toHaveLength(0);
    });

    it("does not let an old response replace a newer completed result", async () => {
        const old = deferred();
        mockAssess.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ available: false, reason: "NATIVE_REBUILD_REQUIRED" });
        const screen = await render();
        await press(screen, "route-quality-assess");
        await press(screen, fixtureButton(1));
        await press(screen, "route-quality-assess");
        await act(async () => old.resolve(available));
        expect(screen.root.findByProps({ testID: "route-quality-status" }).props.children).toBe("검사 불가");
        expect(JSON.stringify(screen.toJSON())).toContain("NATIVE_REBUILD_REQUIRED");
    });

    it("deduplicates rapid repeated assessment presses", async () => {
        const request = deferred();
        mockAssess.mockReturnValue(request.promise);
        const screen = await render();
        await act(async () => {
            const button = screen.root.findByProps({ testID: "route-quality-assess" });
            button.props.onPress();
            button.props.onPress();
        });
        expect(mockAssess).toHaveBeenCalledTimes(1);
        await act(async () => request.resolve(available));
    });

    it("shows unavailable native capability without creating a result or starting guidance", async () => {
        mockAssess.mockResolvedValue({ available: false, reason: "NATIVE_REBUILD_REQUIRED" });
        const screen = await render();
        await press(screen, "route-quality-assess");
        expect(screen.root.findByProps({ testID: "route-quality-unavailable" })).toBeTruthy();
        expect(screen.root.findAllByProps({ testID: "route-quality-result" })).toHaveLength(0);
        expect(screen.root.findByProps({ testID: "route-quality-guidance-state" }).props.children).toBe("자동 길안내 OFF");
    });

    it("handles rejected assessment without displaying raw error details", async () => {
        mockAssess.mockRejectedValue(new Error("private raw diagnostic payload"));
        const screen = await render();
        await press(screen, "route-quality-assess");
        expect(JSON.stringify(screen.toJSON())).toContain("ASSESSMENT_FAILED");
        expect(JSON.stringify(screen.toJSON())).not.toContain("private raw diagnostic payload");
        expect(screen.root.findByProps({ testID: "route-quality-assess" }).props.disabled).toBe(false);
    });

    it("ignores completion after unmounting", async () => {
        const request = deferred();
        mockAssess.mockReturnValue(request.promise);
        const screen = await render();
        await press(screen, "route-quality-assess");
        await act(async () => screen.unmount());
        renderer = undefined;
        await act(async () => request.resolve(available));
        expect(mockAssess).toHaveBeenCalledTimes(1);
    });

    it("closes to schedule when there is no previous route", async () => {
        const screen = await render();
        await press(screen, "route-quality-close");
        expect(mockReplace).toHaveBeenCalledWith("/schedule");
        expect(mockAssess).not.toHaveBeenCalled();
    });

    it("returns to the previous route when available", async () => {
        mockCanGoBack.mockReturnValue(true);
        const screen = await render();
        await press(screen, "route-quality-close");
        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it("redirects release builds without mounting development controls", async () => {
        runtime.__DEV__ = false;
        const screen = await render();
        expect(screen.root.findByType("Redirect" as React.ElementType).props.href).toBe("/schedule");
        expect(screen.root.findAllByProps({ testID: "route-quality-assess" })).toHaveLength(0);
        expect(mockAssess).not.toHaveBeenCalled();
    });
});
