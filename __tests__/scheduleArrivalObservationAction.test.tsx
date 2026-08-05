import React from "react";
import { Alert, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

const mockRecordScheduleArrivalDurably = jest.fn();
const mockActivateArrivalQueue = jest.fn();
const mockRecordObservationEngagement = jest.fn();

jest.mock("expo-constants", () => ({
    __esModule: true,
    default: {
        nativeApplicationVersion: "1.2.0",
        nativeBuildVersion: "42",
        expoConfig: undefined,
    },
}));

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

jest.mock("../src/modules/schedule/scheduleArrivalObservationQueue", () => ({
    recordScheduleArrivalDurably: (...args: unknown[]) =>
        mockRecordScheduleArrivalDurably(...args),
    activateScheduleArrivalObservationQueueForAuthenticatedMember: () =>
        mockActivateArrivalQueue(),
}));

jest.mock("../src/modules/schedule/scheduleEtaObservationEngagementQueue", () => ({
    recordScheduleEtaObservationEngagementDurably: (...args: unknown[]) =>
        mockRecordObservationEngagement(...args),
}));

import ScheduleArrivalObservationAction, {
    hasMeaningfulViewportExposure,
} from "../src/modules/schedule/components/detail/ScheduleArrivalObservationAction";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

function confirmationAction(): (() => void) | undefined {
    const confirmation = jest.mocked(Alert.alert).mock.calls.find(
        ([title]) => title === "도착을 기록할까요?",
    );
    const buttons = confirmation?.[2];
    return buttons?.find((button) => button.text === "도착 기록")?.onPress;
}

function adjustedAction(): (() => void) | undefined {
    const confirmation = jest.mocked(Alert.alert).mock.calls.find(
        ([title]) => title === "도착을 기록할까요?",
    );
    return confirmation?.[2]?.find((button) => button.text === "5분 전")?.onPress;
}

async function flushAsyncAction(action?: () => void): Promise<void> {
    await act(async () => {
        action?.();
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe("schedule arrival observation action", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
        mockRecordScheduleArrivalDurably.mockResolvedValue("sent");
        mockActivateArrivalQueue.mockResolvedValue(0);
        mockRecordObservationEngagement.mockResolvedValue("sent");
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    it("requires at least half of the rendered card to intersect the viewport", () => {
        expect(hasMeaningfulViewportExposure(
            { x: 0, y: 51, width: 100, height: 100 },
            { width: 100, height: 100 },
        )).toBe(false);
        expect(hasMeaningfulViewportExposure(
            { x: 0, y: 50, width: 100, height: 100 },
            { width: 100, height: 100 },
        )).toBe(true);
    });

    it("is absent until the current member has an explicit departure timestamp", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleArrivalObservationAction scheduleId="41" />
                </ThemeProvider>,
            );
        });

        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "현재 시각으로 도착 기록",
        })).toHaveLength(0);
        expect(mockRecordScheduleArrivalDurably).not.toHaveBeenCalled();
        expect(mockRecordObservationEngagement).not.toHaveBeenCalled();
    });

    it("requires explicit consent and sends no request before confirmation", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleArrivalObservationAction
                        scheduleId="41"
                        myDepartedAt="2026-07-31T00:30:00Z"
                    />
                </ThemeProvider>,
            );
        });

        const button = renderer!.root.findByProps({
            accessibilityLabel: "현재 시각으로 도착 기록",
        });
        await act(async () => button.props.onPress());

        expect(mockRecordObservationEngagement).toHaveBeenCalledWith(
            "41",
            {
                event: "PROMPT_OPENED",
                clientAppVersion: "1.2.0",
                clientBuildVersion: "42",
                uxVariant: "arrival-card-v1",
            },
        );

        expect(Alert.alert).toHaveBeenCalledWith(
            "도착을 기록할까요?",
            expect.stringContaining("위치 정보는 수집하지 않아요"),
            expect.any(Array),
        );
        expect(mockRecordScheduleArrivalDurably).not.toHaveBeenCalled();

        await flushAsyncAction(confirmationAction());

        expect(mockRecordScheduleArrivalDurably).toHaveBeenCalledWith(
            "41",
            expect.objectContaining({
                arrivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
                observationSource: "USER_NOW",
                precisionSeconds: 30,
                clientAppVersion: "1.2.0",
                clientBuildVersion: "42",
            }),
        );
        expect(Alert.alert).toHaveBeenCalledWith(
            "도착이 기록됐어요",
            "위치 정보 없이 지금 시각을 도착 시각으로 기록했습니다.",
        );
        expect(renderer!.root.findByProps({
            accessibilityLabel: "도착 기록 완료",
        }).props.disabled).toBe(true);
        const text = renderer!.root.findAllByType(Text)
            .map((node) => node.props.children)
            .flat(Infinity)
            .join(" ");
        expect(text).toContain("기록 완료");
    });

    it("records exposure only after the card is actually measured inside the viewport", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleArrivalObservationAction
                        scheduleId="41"
                        myDepartedAt="2026-07-31T00:30:00Z"
                    />
                </ThemeProvider>,
            );
        });

        expect(mockRecordObservationEngagement).not.toHaveBeenCalled();
        const card = renderer!.root.findByProps({
            testID: "schedule-arrival-observation-card",
        });
        const nativeView = card.instance as {
            measureInWindow: jest.Mock;
        };
        nativeView.measureInWindow.mockImplementation((callback: (
            x: number,
            y: number,
            width: number,
            height: number,
        ) => void) => callback(10, 20, 300, 80));
        await act(async () => {
            card.props.onLayout();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockRecordObservationEngagement).toHaveBeenCalledWith(
            "41",
            {
                event: "EXPOSED",
                clientAppVersion: "1.2.0",
                clientBuildVersion: "42",
                uxVariant: "arrival-card-v1",
            },
        );
    });

    it("shows the server error and lets the user retry", async () => {
        mockRecordScheduleArrivalDurably.mockResolvedValueOnce("rejected");
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleArrivalObservationAction
                        scheduleId="41"
                        myDepartedAt="2026-07-31T00:30:00Z"
                    />
                </ThemeProvider>,
            );
        });

        const button = renderer!.root.findByProps({
            accessibilityLabel: "현재 시각으로 도착 기록",
        });
        await act(async () => button.props.onPress());
        await flushAsyncAction(confirmationAction());

        expect(Alert.alert).toHaveBeenCalledWith(
            "도착 기록 실패",
            "도착 기록을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
        expect(renderer!.root.findByProps({
            accessibilityLabel: "현재 시각으로 도착 기록",
        }).props.disabled).toBe(false);

        mockRecordScheduleArrivalDurably.mockResolvedValueOnce("sent");
        await act(async () => button.props.onPress());
        await flushAsyncAction(confirmationAction());
        expect(mockRecordScheduleArrivalDurably).toHaveBeenCalledTimes(2);
        expect(mockRecordScheduleArrivalDurably.mock.calls[1]?.[1]).toEqual(
            mockRecordScheduleArrivalDurably.mock.calls[0]?.[1],
        );
    });

    it("marks a durable offline observation complete and explains deferred delivery", async () => {
        mockRecordScheduleArrivalDurably.mockResolvedValueOnce("queued");
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleArrivalObservationAction
                        scheduleId="41"
                        myDepartedAt="2026-07-31T00:30:00Z"
                    />
                </ThemeProvider>,
            );
        });

        await act(async () => renderer!.root.findByProps({
            accessibilityLabel: "현재 시각으로 도착 기록",
        }).props.onPress());
        await flushAsyncAction(confirmationAction());

        expect(Alert.alert).toHaveBeenCalledWith(
            "도착 시각을 보관했어요",
            "연결되면 같은 도착 시각으로 자동 전송합니다.",
        );
        expect(renderer!.root.findByProps({ accessibilityLabel: "도착 기록 완료" }))
            .toBeTruthy();
    });

    it("stores the five-minute recall bucket with conservative ineligible precision", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleArrivalObservationAction
                        scheduleId="41"
                        myDepartedAt="2026-07-31T00:30:00Z"
                    />
                </ThemeProvider>,
            );
        });

        await act(async () => renderer!.root.findByProps({
            accessibilityLabel: "현재 시각으로 도착 기록",
        }).props.onPress());
        await flushAsyncAction(adjustedAction());

        expect(mockRecordScheduleArrivalDurably).toHaveBeenCalledWith(
            "41",
            expect.objectContaining({
                arrivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
                observationSource: "USER_ADJUSTED",
                precisionSeconds: 300,
                adjustmentSeconds: 300,
            }),
        );
        expect(Alert.alert).toHaveBeenCalledWith(
            "도착이 기록됐어요",
            "위치 정보 없이 5분 전 시각을 도착 시각으로 기록했습니다.",
        );
    });

    it("suppresses repeated confirmation callbacks while one record is pending", async () => {
        const pending = deferred<"sent">();
        mockRecordScheduleArrivalDurably.mockReturnValueOnce(pending.promise);
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleArrivalObservationAction
                        scheduleId="41"
                        myDepartedAt="2026-07-31T00:30:00Z"
                    />
                </ThemeProvider>,
            );
        });

        const button = renderer!.root.findByProps({
            accessibilityLabel: "현재 시각으로 도착 기록",
        });
        await act(async () => button.props.onPress());
        const confirm = confirmationAction();
        await act(async () => {
            confirm?.();
            confirm?.();
            await Promise.resolve();
        });

        expect(mockRecordScheduleArrivalDurably).toHaveBeenCalledTimes(1);
        expect(renderer!.root.findByProps({
            accessibilityLabel: "현재 시각으로 도착 기록",
        }).props.accessibilityState.busy).toBe(true);

        pending.resolve("sent");
        await flushAsyncAction();
        expect(renderer!.root.findByProps({
            accessibilityLabel: "도착 기록 완료",
        })).toBeTruthy();
    });
});
