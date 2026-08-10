import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getAuthMember } from "../../src/modules/auth/authStorage";
import {
    endLiveActivity,
    getLiveActivityCapabilities,
    startOrUpdateLiveActivity,
    type LiveActivityMutationResult,
    type LiveActivityStartOrUpdateInput,
} from "../../src/modules/notification/liveActivity";
import {
    buildLiveActivityTravelSnapshot,
    type LiveActivityRouteSegment,
} from "../../src/modules/notification/liveActivityRoute";
import {
    buildLiveActivityPreviewIdentity,
} from "../../src/modules/notification/liveActivityPreviewFixture";
import { useTheme } from "../../src/modules/theme/ThemeContext";

const PREVIEW_SCHEDULE_ID = "990000001";
const PREVIEW_ROUTE = {
    routeInfo: {
        id: "live-activity-preview-route",
        originName: "집",
        destinationName: "강남역",
        totalDurationMinutes: 36,
        departureTime: "2026-08-06T09:24:00+09:00",
        arrivalTime: "2026-08-06T10:00:00+09:00",
        timeBasis: "provider_schedule" as const,
        steps: [
            {
                id: "preview-walk",
                type: "WALK" as const,
                title: "도보",
                durationMinutes: 4,
            },
            {
                id: "preview-bus",
                type: "BUS" as const,
                title: "정류장",
                lineName: "간선 402",
                lineColor: "#2979FF",
                durationMinutes: 17,
                waitingMinutes: 6,
            },
            {
                id: "preview-subway",
                type: "SUBWAY" as const,
                title: "2호선",
                lineName: "2호선",
                lineColor: "#00B140",
                durationMinutes: 15,
            },
        ],
    },
};

const PREVIEW_TRAVEL = buildLiveActivityTravelSnapshot({
    route: PREVIEW_ROUTE,
    travelMinutes: 36,
});
const PREVIEW_ROUTE_SEGMENTS = PREVIEW_TRAVEL?.routeSegments ?? [];

function addMinutes(date: Date, minutes: number): string {
    return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function resultText(result: LiveActivityMutationResult | undefined): string {
    if (!result) return "아직 실행하지 않았어요.";
    const operation = result.operation;
    const activity = result.activityId ? ` · ${result.activityId}` : "";
    const reason = result.reason ? ` · ${result.reason}` : "";
    return `${result.applied ? "성공" : "미적용"} · ${operation}${activity}${reason}`;
}

function RouteBar({ segments }: { segments: LiveActivityRouteSegment[] }) {
    return (
        <View style={styles.routeBar} accessibilityLabel="도보, 402번 버스, 2호선 경로">
            {segments.map((segment, index) => (
                <React.Fragment key={`${segment.kind}-${segment.label}-${index}`}>
                    {index > 0 ? <View style={styles.routeConnector} /> : null}
                    <View style={styles.routeSegmentWrap}>
                        <View style={[styles.routeDot, { backgroundColor: segment.colorHex }]} />
                        <Text style={styles.routeLabel}>{segment.label}</Text>
                    </View>
                </React.Fragment>
            ))}
        </View>
    );
}

export default function LiveActivityPreviewScreen() {
    const { auto } = useLocalSearchParams<{ auto?: string | string[] }>();
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const [recipientMemberId, setRecipientMemberId] = useState(1);
    const [memberReady, setMemberReady] = useState(false);
    const [revision, setRevision] = useState(1);
    const [working, setWorking] = useState<string>();
    const [capabilityText, setCapabilityText] = useState("확인 중");
    const [result, setResult] = useState<LiveActivityMutationResult>();
    const autoRunStartedRef = useRef(false);
    const routeSegments = PREVIEW_ROUTE_SEGMENTS;
    const scheduleStartAtRef = useRef(addMinutes(new Date(), 40));

    useEffect(() => {
        getAuthMember()
            .then((member) => {
                if (member?.id) setRecipientMemberId(member.id);
                setMemberReady(true);
            })
            .catch(() => setMemberReady(true));
        getLiveActivityCapabilities()
            .then((capabilities) => {
                setCapabilityText(
                    !capabilities.supported
                        ? capabilities.reason ?? "지원하지 않는 환경"
                        : !capabilities.enabled
                            ? "기기 설정에서 비활성화됨"
                            : capabilities.canStartRemotely
                                ? "원격 시작·표시·업데이트 가능"
                                : "표시·업데이트만 가능 · 원격 시작은 iOS 17.2+",
                );
            })
            .catch((error) => setCapabilityText(
                error instanceof Error ? error.message : "확인 실패",
            ));
    }, []);

    const makeInput = useMemo(() => (nextRevision: number): LiveActivityStartOrUpdateInput => {
        const now = new Date();
        const recommendedDepartureAt = nextRevision === 1
            ? addMinutes(now, 4)
            : now.toISOString();
        return {
            scheduleId: PREVIEW_SCHEDULE_ID,
            recipientMemberId,
            ...buildLiveActivityPreviewIdentity(nextRevision),
            scheduleTitle: "강남역 미팅",
            destinationName: "강남역",
            // Immutable for every update in this mounted preview generation.
            scheduleStartAt: scheduleStartAtRef.current,
            travelMinutes: PREVIEW_TRAVEL?.travelMinutes ?? 36,
            firstWaitMinutes: PREVIEW_TRAVEL?.firstWaitMinutes,
            predictedArrivalAt: addMinutes(now, PREVIEW_TRAVEL?.travelMinutes ?? 36),
            recommendedDepartureAt,
            updatedAt: now.toISOString(),
            staleAt: addMinutes(now, 15),
            status: nextRevision === 1 ? "preparing" : "leaveNow",
            actionExpiresAt: addMinutes(now, 30),
            logicalEventKey: `preview:${PREVIEW_SCHEDULE_ID}:generation:1`,
            routeSegments,
        };
    }, [recipientMemberId, routeSegments]);

    useEffect(() => {
        const autoMode = Array.isArray(auto) ? auto[0] : auto;
        if (
            !__DEV__ ||
            !memberReady ||
            autoRunStartedRef.current ||
            (autoMode !== "start" && autoMode !== "leave-now")
        ) {
            return;
        }

        autoRunStartedRef.current = true;
        let cancelled = false;

        const runAutoPreview = async () => {
            setWorking("start");
            try {
                let latestResult = await startOrUpdateLiveActivity(makeInput(1));
                if (cancelled) return;
                setRevision(1);
                setResult(latestResult);

                if (autoMode === "leave-now") {
                    setWorking("update");
                    latestResult = await startOrUpdateLiveActivity(makeInput(2));
                    if (cancelled) return;
                    setRevision(2);
                    setResult(latestResult);
                }
            } catch (error) {
                if (cancelled) return;
                setResult({
                    supported: true,
                    applied: false,
                    operation: "ignored",
                    reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
                });
            } finally {
                if (!cancelled) setWorking(undefined);
            }
        };

        void runAutoPreview();
        return () => {
            cancelled = true;
        };
    }, [auto, makeInput, memberReady]);

    const run = async (operation: "start" | "update" | "end") => {
        setWorking(operation);
        try {
            if (operation === "end") {
                setResult(await endLiveActivity({
                    scheduleId: PREVIEW_SCHEDULE_ID,
                    recipientMemberId,
                    revision: revision + 1,
                    updatedAt: new Date().toISOString(),
                    dismissalPolicy: "immediate",
                }));
                return;
            }
            const nextRevision = operation === "start" ? 1 : revision + 1;
            setRevision(nextRevision);
            setResult(await startOrUpdateLiveActivity(makeInput(nextRevision)));
        } catch (error) {
            setResult({
                supported: true,
                applied: false,
                operation: "ignored",
                reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
            });
        } finally {
            setWorking(undefined);
        }
    };

    if (!__DEV__) return null;

    return (
        <ScrollView
            contentContainerStyle={[
                styles.content,
                {
                    paddingTop: insets.top + 28,
                    paddingBottom: insets.bottom + 32,
                    backgroundColor: colors.background,
                },
            ]}
        >
            <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>DEVELOPMENT ONLY</Text>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Live Activity E2E</Text>
            <Text style={[styles.caption, { color: colors.textSecondary }]}>상태: {capabilityText}</Text>

            <View style={styles.mockCard}>
                <View style={styles.cardTopRow}>
                    <View>
                        <Text style={styles.destination}>강남역 · 오전 10:00</Text>
                        <Text style={styles.headline}>출발까지 4분 남았어요</Text>
                    </View>
                    <View style={styles.etaBadge}>
                        <Text style={styles.etaValue}>36</Text>
                        <Text style={styles.etaUnit}>분</Text>
                    </View>
                </View>
                <RouteBar segments={routeSegments} />
                <View style={styles.mockActions}>
                    <View style={styles.mockScheduleAction}>
                        <Text style={styles.mockScheduleActionText}>일정 확인</Text>
                    </View>
                    <View style={styles.mockDepartureAction}>
                        <Text style={styles.mockDepartureActionText}>출발 완료</Text>
                    </View>
                </View>
            </View>

            <View style={styles.buttons}>
                {([
                    ["start", "시작"],
                    ["update", "업데이트"],
                    ["end", "종료"],
                ] as const).map(([operation, label]) => (
                    <Pressable
                        key={operation}
                        accessibilityRole="button"
                        disabled={working !== undefined || !memberReady}
                        onPress={() => run(operation)}
                        style={({ pressed }) => [
                            styles.button,
                            operation === "end" ? styles.endButton : styles.primaryButton,
                            pressed && styles.pressed,
                            (working !== undefined || !memberReady) && styles.disabled,
                        ]}
                    >
                        {working === operation
                            ? <ActivityIndicator color="#FFFFFF" />
                            : <Text style={styles.buttonText}>{label}</Text>}
                    </Pressable>
                ))}
            </View>

            <View style={[styles.resultCard, { borderColor: colors.border }]}>
                <Text style={[styles.resultTitle, { color: colors.textPrimary }]}>최근 결과</Text>
                <Text selectable style={[styles.resultBody, { color: colors.textSecondary }]}>
                    {resultText(result)}
                </Text>
                <Text style={[styles.resultMeta, { color: colors.textSecondary }]}>revision {revision}</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: {
        flexGrow: 1,
        paddingHorizontal: 20,
        gap: 10,
    },
    eyebrow: {
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 1.3,
    },
    title: {
        fontSize: 30,
        fontWeight: "800",
    },
    caption: {
        fontSize: 14,
        marginBottom: 14,
    },
    mockCard: {
        borderRadius: 26,
        padding: 20,
        backgroundColor: "#FFFFFF",
        shadowColor: "#101828",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
        elevation: 4,
    },
    cardTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
    },
    destination: {
        color: "#4F5760",
        fontSize: 13,
        fontWeight: "700",
        marginBottom: 6,
    },
    headline: {
        color: "#101828",
        fontSize: 19,
        lineHeight: 26,
        fontWeight: "800",
    },
    etaBadge: {
        minWidth: 58,
        height: 58,
        borderRadius: 18,
        backgroundColor: "#FFF1EE",
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "center",
        paddingTop: 11,
    },
    etaValue: {
        color: "#FF5A45",
        fontSize: 24,
        fontWeight: "900",
    },
    etaUnit: {
        color: "#FF5A45",
        fontSize: 12,
        fontWeight: "800",
    },
    routeBar: {
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: 22,
    },
    routeSegmentWrap: {
        alignItems: "center",
        minWidth: 44,
    },
    routeDot: {
        width: 13,
        height: 13,
        borderRadius: 7,
        borderColor: "#FFFFFF",
        borderWidth: 2,
    },
    routeConnector: {
        flex: 1,
        minWidth: 24,
        height: 3,
        marginTop: 5,
        backgroundColor: "#E8EAED",
    },
    routeLabel: {
        color: "#4F5760",
        fontSize: 11,
        fontWeight: "700",
        marginTop: 5,
    },
    mockActions: {
        flexDirection: "row",
        gap: 10,
        marginTop: 14,
    },
    mockScheduleAction: {
        flex: 1,
        height: 38,
        borderRadius: 19,
        borderWidth: 1.5,
        borderColor: "#0867E8",
        alignItems: "center",
        justifyContent: "center",
    },
    mockScheduleActionText: {
        color: "#0867E8",
        fontSize: 14,
        fontWeight: "800",
    },
    mockDepartureAction: {
        flex: 1,
        height: 38,
        borderRadius: 19,
        backgroundColor: "#0867E8",
        alignItems: "center",
        justifyContent: "center",
    },
    mockDepartureActionText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "800",
    },
    buttons: {
        flexDirection: "row",
        gap: 9,
        marginTop: 12,
    },
    button: {
        flex: 1,
        height: 50,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    primaryButton: {
        backgroundColor: "#FF5A45",
    },
    endButton: {
        backgroundColor: "#29313D",
    },
    buttonText: {
        color: "#FFFFFF",
        fontSize: 15,
        fontWeight: "800",
    },
    pressed: {
        opacity: 0.7,
        transform: [{ scale: 0.98 }],
    },
    disabled: {
        opacity: 0.55,
    },
    resultCard: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 18,
        padding: 16,
        marginTop: 6,
    },
    resultTitle: {
        fontSize: 14,
        fontWeight: "800",
        marginBottom: 6,
    },
    resultBody: {
        fontSize: 12,
        lineHeight: 18,
    },
    resultMeta: {
        fontSize: 11,
        marginTop: 8,
    },
});
