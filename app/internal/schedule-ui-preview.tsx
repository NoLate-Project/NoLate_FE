import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PlainScheduleDetailView, {
    PLAIN_SCHEDULE_DETAIL_CONTENT_GAP,
    PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT,
} from "../../src/modules/schedule/components/detail/PlainScheduleDetailView";
import QuickScheduleModal from "../../src/modules/schedule/components/form/QuickScheduleModal";
import ScheduleAddModal from "../../src/modules/schedule/components/form/ScheduleAddModal";
import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import type {
    ScheduleCategory,
    ScheduleItem,
    ScheduleParseResult,
} from "../../src/modules/schedule/types";

type PreviewScreen = "create" | "quick" | "edit" | "detail";
type QuickPreviewField = "title" | "date" | "time" | "location" | "notification" | "memo";

const PREVIEW_ID = "schedule-ui-preview";
const PREVIEW_DAY = "2026-08-08";
const previewCategory: ScheduleCategory = {
    id: "preview-personal",
    title: "개인",
    color: "#2979FF",
};

const previewRoute = {
    routeInfo: {
        id: "preview-route",
        originName: "서울역",
        destinationName: "강남역",
        totalDurationMinutes: 36,
        departureTime: "2026-08-08T11:24:00+09:00",
        arrivalTime: "2026-08-08T12:00:00+09:00",
        timeBasis: "estimated" as const,
        steps: [
            {
                id: "preview-subway-leg",
                type: "SUBWAY" as const,
                title: "지하철 이동",
                durationMinutes: 36,
                lineName: "2호선",
                coordinates: [
                    { latitude: 37.5547, longitude: 126.9706 },
                    { latitude: 37.4979, longitude: 127.0276 },
                ],
            },
        ],
    },
};

const previewItem: ScheduleItem = {
    id: PREVIEW_ID,
    title: "강남역에서 점심 약속",
    startAt: "2026-08-08T12:00:00+09:00",
    endAt: "2026-08-08T13:00:00+09:00",
    hasEndTime: true,
    allDay: false,
    category: previewCategory,
    origin: {
        name: "서울역",
        address: "서울특별시 용산구 한강대로 405",
        lat: 37.5547,
        lng: 126.9706,
    },
    destination: {
        name: "강남역",
        address: "서울특별시 강남구 강남대로 396",
        lat: 37.4979,
        lng: 127.0276,
    },
    locationName: "강남역",
    travelMode: "TRANSIT",
    travelMinutes: 36,
    departAt: "2026-08-08T11:24:00+09:00",
    route: previewRoute,
    notificationEnabled: true,
    notificationLeadMinutes: 30,
    notificationIntervalMinutes: 20,
    alertMode: "ALARM",
    notes: "2번 출구 앞에서 만나기",
};

const quickParseResult: ScheduleParseResult = {
    analysisId: "schedule-ui-preview-analysis",
    title: previewItem.title,
    notes: previewItem.notes,
    startAt: previewItem.startAt,
    endAt: previewItem.endAt,
    hasExplicitEndTime: true,
    origin: previewItem.origin,
    originSource: "TEXT",
    originRequired: false,
    destination: previewItem.destination,
    parseSource: "RULE",
    aiAttempted: false,
    needsReview: false,
    warnings: [],
    missingFields: [],
    confidence: {
        overall: 0.98,
        level: "HIGH",
        fields: { date: 0.99, time: 0.98, destination: 0.97 },
        reasons: [],
    },
    travelMode: previewItem.travelMode,
    travelMinutes: previewItem.travelMinutes,
    route: previewItem.route,
    notificationEnabled: true,
    notificationLeadMinutes: 30,
    notificationIntervalMinutes: 20,
    alertMode: "ALARM",
};

function PreviewBackdrop({ label }: { label: string }) {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();

    return (
        <View
            style={[
                styles.backdrop,
                {
                    paddingTop: insets.top + 12,
                    backgroundColor: colors.background,
                },
            ]}
        >
            <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>{label}</Text>
        </View>
    );
}

function DetailPreview() {
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const headerHeight = insets.top + PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT;

    return (
        <View style={[styles.detailRoot, { backgroundColor: colors.background }]}>
            <PlainScheduleDetailView
                item={previewItem}
                contentTopInset={headerHeight + PLAIN_SCHEDULE_DETAIL_CONTENT_GAP}
                contentBottomInset={Math.max(insets.bottom + 32, 48)}
            />
            <View
                style={[
                    styles.detailHeader,
                    {
                        paddingTop: insets.top + 8,
                        height: headerHeight,
                        borderBottomColor: colors.border,
                        backgroundColor: colors.background,
                    },
                ]}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="일정 상세 닫기"
                    onPress={() => router.setParams({ screen: "create" })}
                    hitSlop={10}
                    style={styles.headerButton}
                >
                    <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>일정 상세</Text>
                <View style={styles.headerActions}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="일정 공유"
                        onPress={() => undefined}
                        hitSlop={10}
                        style={styles.headerButton}
                    >
                        <Ionicons name="share-social-outline" size={20} color={colors.textPrimary} />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="일정 수정 열기"
                        onPress={() => router.setParams({
                            screen: "edit",
                            id: PREVIEW_ID,
                            preview: "1",
                        })}
                        hitSlop={10}
                        style={({ pressed }) => [
                            styles.headerButton,
                            {
                                backgroundColor: pressed
                                    ? mode === "dark"
                                        ? "rgba(75,157,255,0.14)"
                                        : "rgba(41,121,255,0.08)"
                                    : "transparent",
                                opacity: pressed ? 0.58 : 1,
                            },
                        ]}
                    >
                        <Ionicons name="pencil-outline" size={19} color={accent} />
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

function EditPreview({ initialScrollToEnd = false }: { initialScrollToEnd?: boolean }) {
    const { state, dispatch } = useScheduleStore();

    useEffect(() => {
        dispatch({ type: "SET_CATEGORIES", categories: [previewCategory] });
        dispatch({ type: "UPDATE_ITEM", item: previewItem });
    }, [dispatch]);

    if (!state.itemsById[PREVIEW_ID]) {
        return <PreviewBackdrop label="일정 수정 화면을 준비하고 있어요" />;
    }

    return <ScheduleEditScreen initialScrollToEnd={initialScrollToEnd} />;
}

export default function ScheduleUiPreviewScreen() {
    const params = useLocalSearchParams<{
        screen?: PreviewScreen;
        id?: string;
        preview?: string;
        field?: QuickPreviewField;
        section?: "top" | "bottom";
    }>();
    const router = useRouter();
    const { dispatch } = useScheduleStore();
    const screen = params.screen ?? "create";
    const [visibleModalScreen, setVisibleModalScreen] = useState<"create" | "quick" | null>(null);

    useEffect(() => {
        setVisibleModalScreen(null);
        if (screen !== "create" && screen !== "quick") return undefined;

        const frame = requestAnimationFrame(() => setVisibleModalScreen(screen));
        return () => cancelAnimationFrame(frame);
    }, [screen]);

    useEffect(() => {
        dispatch({ type: "SET_CATEGORIES", categories: [previewCategory] });
        dispatch({ type: "UPDATE_ITEM", item: previewItem });
    }, [dispatch]);

    useEffect(() => {
        if (screen !== "edit" || (params.id === PREVIEW_ID && params.preview === "1")) return;
        router.setParams({ id: PREVIEW_ID, preview: "1" });
    }, [params.id, params.preview, router, screen]);

    const quickInitialText = useMemo(
        () => "8월 8일 낮 12시 강남역에서 점심 약속, 서울역에서 출발",
        [],
    );
    const quickPreviewField = useMemo<QuickPreviewField | undefined>(() => {
        const field = params.field;
        return field && ["title", "date", "time", "location", "notification", "memo"].includes(field)
            ? field
            : undefined;
    }, [params.field]);

    if (!__DEV__) return null;

    if (screen === "edit") {
        if (params.id !== PREVIEW_ID || params.preview !== "1") {
            return <PreviewBackdrop label="일정 수정 화면을 준비하고 있어요" />;
        }
        return <EditPreview initialScrollToEnd={params.section === "bottom"} />;
    }

    if (screen === "detail") return <DetailPreview />;

    if (screen === "quick") {
        return (
            <View style={styles.full}>
                <PreviewBackdrop label="빠른 일정 · 실제 컴포넌트 QA" />
                <QuickScheduleModal
                    visible={visibleModalScreen === "quick"}
                    initialText={quickInitialText}
                    initialRequestId={`schedule-ui-preview-request-${quickPreviewField ?? "preview"}`}
                    initialPreviewField={quickPreviewField}
                    defaultDay={PREVIEW_DAY}
                    defaultCategory={previewCategory}
                    sourceTopOffset={4}
                    sourceWidth={238}
                    sourceHeight={164}
                    sourceRightOffset={8}
                    closeTargetWidth={150}
                    onAnalyze={async () => quickParseResult}
                    onSave={() => undefined}
                    onClose={() => setVisibleModalScreen(null)}
                />
            </View>
        );
    }

    return (
        <View style={styles.full}>
            <PreviewBackdrop label="일정 생성 · 실제 컴포넌트 QA" />
            <ScheduleAddModal
                visible={visibleModalScreen === "create"}
                presentation="morph"
                categories={[previewCategory]}
                defaultDay={PREVIEW_DAY}
                sourceTopOffset={4}
                sourceWidth={238}
                sourceHeight={164}
                sourceRightOffset={8}
                closeTargetWidth={150}
                onSubmit={() => undefined}
                onClose={() => setVisibleModalScreen(null)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    full: {
        flex: 1,
    },
    backdrop: {
        flex: 1,
        paddingHorizontal: 20,
    },
    previewLabel: {
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.2,
    },
    detailRoot: {
        flex: 1,
    },
    detailHeader: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
    },
    headerButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    headerActions: {
        marginLeft: "auto",
        flexDirection: "row",
        alignItems: "center",
    },
    headerTitle: {
        position: "absolute",
        left: 88,
        right: 88,
        bottom: 22,
        fontSize: 17,
        fontWeight: "700",
        textAlign: "center",
    },
});
