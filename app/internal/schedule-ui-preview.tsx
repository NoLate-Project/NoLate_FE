import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import PlainScheduleDetailView, {
    PLAIN_SCHEDULE_DETAIL_CONTENT_GAP,
    PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT,
} from "../../src/modules/schedule/components/detail/PlainScheduleDetailView";
import RouteDetailDesignPreview, {
    type RouteDetailDesignVariant,
    type RouteDetailPreviewSheetMode,
} from "../../src/modules/schedule/components/detail/RouteDetailDesignPreview";
import QuickScheduleModal from "../../src/modules/schedule/components/form/QuickScheduleModal";
import ScheduleAddModal from "../../src/modules/schedule/components/form/ScheduleAddModal";
import ScheduleEditScreen from "../../src/modules/schedule/screens/ScheduleEditScreen";
import { ScheduleDetail as ActualScheduleDetail } from "../schedule/[id]";
import RouteSelectScreen from "../schedule/route-select";
import { buildSavedRouteDetailInfo } from "../../src/modules/schedule/savedRouteDetailPresentation";
import { useScheduleStore } from "../../src/modules/schedule/store";
import { setRoutePlannerInitial } from "../../src/modules/schedule/routePlannerSession";
import { buildTransitRouteProgressSegments } from "../../src/modules/schedule/transitRouteProgress";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import type {
    ScheduleCategory,
    ScheduleItem,
    ScheduleParseResult,
} from "../../src/modules/schedule/types";

type PreviewScreen = "create" | "quick" | "edit" | "detail" | "route" | "route-detail";
type QuickPreviewField = "title" | "date" | "time" | "location" | "notification" | "memo";

const PREVIEW_ID = "schedule-ui-preview";
const PREVIEW_DAY = "2026-08-08";
const previewCategory: ScheduleCategory = {
    id: "preview-personal",
    title: "개인",
    color: "#2979FF",
};
const previewWorkCategory: ScheduleCategory = {
    id: "preview-work",
    title: "업무",
    color: "#FF6B5F",
};
const previewCategories = [previewCategory, previewWorkCategory];

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

const actualRouteDetailRoute = {
    id: "schedule-ui-preview-saved-transit-route",
    mode: "TRANSIT" as const,
    minutes: 36,
    source: "api" as const,
    provider: "odsay" as const,
    transferCount: 1,
    walkMeters: 510,
    fareWon: 1_500,
    pathCoords: [
        { lat: 37.5547, lng: 126.9706 },
        { lat: 37.5538, lng: 126.9721 },
        { lat: 37.5292, lng: 126.9682 },
        { lat: 37.5028, lng: 126.9803 },
        { lat: 37.4765, lng: 126.9816 },
        { lat: 37.4846, lng: 126.9821 },
        { lat: 37.4934, lng: 127.0144 },
        { lat: 37.4979, lng: 127.0276 },
    ],
    transitLegs: [
        {
            kind: "WALK" as const,
            label: "서울역 4호선까지 도보",
            durationMinutes: 5,
            distanceMeters: 340,
            startName: "서울역",
            endName: "서울역 4호선",
            startCoord: { lat: 37.5547, lng: 126.9706 },
            endCoord: { lat: 37.5538, lng: 126.9721 },
            pathCoords: [
                { lat: 37.5547, lng: 126.9706 },
                { lat: 37.5542, lng: 126.9712 },
                { lat: 37.5538, lng: 126.9721 },
            ],
        },
        {
            kind: "SUBWAY" as const,
            label: "4호선",
            lineName: "4호선",
            lineColor: "00A4E3",
            directionName: "오이도 방면",
            durationMinutes: 20,
            stationCount: 7,
            startName: "서울역",
            endName: "사당역",
            startCoord: { lat: 37.5538, lng: 126.9721 },
            endCoord: { lat: 37.4765, lng: 126.9816 },
            passStops: [
                { name: "서울역", coord: { lat: 37.5538, lng: 126.9721 } },
                { name: "숙대입구역", coord: { lat: 37.5446, lng: 126.9721 } },
                { name: "삼각지역", coord: { lat: 37.5347, lng: 126.9731 } },
                { name: "신용산역", coord: { lat: 37.5292, lng: 126.9682 } },
                { name: "이촌역", coord: { lat: 37.5224, lng: 126.9740 } },
                { name: "동작역", coord: { lat: 37.5028, lng: 126.9803 } },
                { name: "총신대입구역", coord: { lat: 37.4875, lng: 126.9822 } },
                { name: "사당역", coord: { lat: 37.4765, lng: 126.9816 } },
            ],
            pathCoords: [
                { lat: 37.5538, lng: 126.9721 },
                { lat: 37.5446, lng: 126.9721 },
                { lat: 37.5347, lng: 126.9731 },
                { lat: 37.5292, lng: 126.9682 },
                { lat: 37.5224, lng: 126.9740 },
                { lat: 37.5028, lng: 126.9803 },
                { lat: 37.4875, lng: 126.9822 },
                { lat: 37.4765, lng: 126.9816 },
            ],
        },
        {
            kind: "WALK" as const,
            label: "2호선 환승",
            durationMinutes: 3,
            distanceMeters: 120,
            startName: "사당역 4호선",
            endName: "사당역 2호선",
            startCoord: { lat: 37.4765, lng: 126.9816 },
            endCoord: { lat: 37.4768, lng: 126.9820 },
            pathCoords: [
                { lat: 37.4765, lng: 126.9816 },
                { lat: 37.4768, lng: 126.9820 },
            ],
        },
        {
            kind: "SUBWAY" as const,
            label: "2호선",
            lineName: "2호선",
            lineColor: "00B140",
            directionName: "잠실 방면",
            durationMinutes: 6,
            stationCount: 3,
            startName: "사당역",
            endName: "강남역",
            startCoord: { lat: 37.4768, lng: 126.9820 },
            endCoord: { lat: 37.4979, lng: 127.0276 },
            passStops: [
                { name: "사당역", coord: { lat: 37.4768, lng: 126.9820 } },
                { name: "방배역", coord: { lat: 37.4814, lng: 126.9975 } },
                { name: "서초역", coord: { lat: 37.4919, lng: 127.0079 } },
                { name: "교대역", coord: { lat: 37.4934, lng: 127.0144 } },
                { name: "강남역", coord: { lat: 37.4979, lng: 127.0276 } },
            ],
            pathCoords: [
                { lat: 37.4768, lng: 126.9820 },
                { lat: 37.4814, lng: 126.9975 },
                { lat: 37.4919, lng: 127.0079 },
                { lat: 37.4934, lng: 127.0144 },
                { lat: 37.4979, lng: 127.0276 },
            ],
        },
        {
            kind: "WALK" as const,
            label: "약속 장소까지 도보",
            durationMinutes: 2,
            distanceMeters: 50,
            startName: "강남역",
            endName: "강남역 2번 출구",
            startCoord: { lat: 37.4979, lng: 127.0276 },
            endCoord: { lat: 37.4982, lng: 127.0280 },
            pathCoords: [
                { lat: 37.4979, lng: 127.0276 },
                { lat: 37.4982, lng: 127.0280 },
            ],
        },
    ],
};
const actualRouteDetailProgressSegments = buildTransitRouteProgressSegments(
    actualRouteDetailRoute.transitLegs
);

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

const actualRouteDetailItem: ScheduleItem = {
    ...previewItem,
    ownerMemberId: 101,
    locationName: "서울역 → 강남역",
    route: actualRouteDetailRoute,
    departureParticipants: [
        {
            memberId: 101,
            email: "you@nolate.app",
            role: "OWNER",
            departed: false,
        },
        {
            memberId: 102,
            email: "민지@nolate.app",
            role: "SHARED",
            departed: true,
            departedAt: "2026-08-08T11:02:00+09:00",
        },
        {
            memberId: 103,
            email: "준호@nolate.app",
            role: "SHARED",
            departed: false,
        },
    ],
};
const actualRouteDetailInfo = buildSavedRouteDetailInfo({
    route: actualRouteDetailRoute,
    routeAlternative: actualRouteDetailRoute,
    origin: actualRouteDetailItem.origin,
    destination: actualRouteDetailItem.destination,
    departureAt: new Date("2026-08-08T11:24:00+09:00"),
}) ?? previewRoute.routeInfo;

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
                    onPress={() => router.setParams({ view: "create" })}
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
                            view: "edit",
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

function EditPreview({
    initialScrollToEnd = false,
    initialCategoryPickerOpen = false,
}: {
    initialScrollToEnd?: boolean;
    initialCategoryPickerOpen?: boolean;
}) {
    const { state, dispatch } = useScheduleStore();

    useEffect(() => {
        dispatch({ type: "SET_CATEGORIES", categories: previewCategories });
        dispatch({ type: "UPDATE_ITEM", item: previewItem });
    }, [dispatch]);

    if (!state.itemsById[PREVIEW_ID]) {
        return <PreviewBackdrop label="일정 수정 화면을 준비하고 있어요" />;
    }

    return (
        <ScheduleEditScreen
            initialScrollToEnd={initialScrollToEnd}
            initialCategoryPickerOpen={initialCategoryPickerOpen}
        />
    );
}

function RouteInputPreview() {
    const router = useRouter();
    const params = useLocalSearchParams<{ sessionId?: string; editTarget?: string }>();
    const sessionId = "schedule-ui-preview-route";
    const paramsReady = params.sessionId === sessionId && params.editTarget === "destination";

    useEffect(() => {
        setRoutePlannerInitial(sessionId, {
            origin: previewItem.origin,
            destination: previewItem.destination,
            travelMode: previewItem.travelMode ?? "TRANSIT",
            travelMinutes: previewItem.travelMinutes,
            locationName: "서울역 → 강남역",
            targetArrivalAt: previewItem.startAt,
            departureAt: previewItem.departAt,
            route: previewItem.route,
        });

        if (paramsReady) return;
        const frame = requestAnimationFrame(() => {
            router.setParams({ sessionId, editTarget: "destination" });
        });
        return () => cancelAnimationFrame(frame);
    }, [paramsReady, router, sessionId]);

    if (!paramsReady) {
        return <PreviewBackdrop label="이동 경로 입력 화면을 준비하고 있어요" />;
    }

    return <RouteSelectScreen />;
}

export default function ScheduleUiPreviewScreen() {
    const params = useLocalSearchParams<{
        view?: PreviewScreen;
        id?: string;
        preview?: string;
        field?: QuickPreviewField;
        section?: "top" | "bottom";
        category?: "open";
        design?: RouteDetailDesignVariant;
        sheet?: RouteDetailPreviewSheetMode;
        people?: "expanded";
    }>();
    const router = useRouter();
    const { dispatch } = useScheduleStore();
    const screen = params.view ?? "create";
    const [visibleModalScreen, setVisibleModalScreen] = useState<"create" | "quick" | null>(null);

    useEffect(() => {
        setVisibleModalScreen(null);
        if (screen !== "create" && screen !== "quick") return undefined;

        const frame = requestAnimationFrame(() => setVisibleModalScreen(screen));
        return () => cancelAnimationFrame(frame);
    }, [screen]);

    useEffect(() => {
        dispatch({ type: "SET_CATEGORIES", categories: previewCategories });
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
        return (
            <EditPreview
                initialScrollToEnd={params.section === "bottom"}
                initialCategoryPickerOpen={params.category === "open"}
            />
        );
    }

    if (screen === "detail") return <DetailPreview />;
    if (screen === "route") return <RouteInputPreview />;
    if (screen === "route-detail") {
        if (params.design === "current") {
            return (
                <RouteDetailDesignPreview
                    key={`current-${params.sheet ?? "expanded"}`}
                    variant="current"
                    initialSheetMode={params.sheet === "compact" ? "compact" : "expanded"}
                    routeDetailInfo={actualRouteDetailInfo}
                    routeProgressSegments={actualRouteDetailProgressSegments}
                />
            );
        }
        return (
            <ActualScheduleDetail
                key={`improved-${params.sheet ?? "expanded"}-${params.people ?? "collapsed"}`}
                previewItem={actualRouteDetailItem}
                initialSheetMode={params.sheet === "compact" ? "compact" : "expanded"}
                initialParticipantsExpanded={params.people === "expanded"}
                previewNowMs={new Date("2026-08-08T11:06:00+09:00").getTime()}
                previewCurrentMemberId={101}
            />
        );
    }

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
                    categories={previewCategories}
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
                categories={previewCategories}
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
