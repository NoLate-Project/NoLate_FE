import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getCalendarProviderLabel,
    getDefaultSelectedCandidateIds,
    getDeviceCalendarProvider,
    hasDeviceCalendarPermission,
    loadDeviceCalendarImportSummary,
    type DeviceCalendarCandidate,
    type DeviceCalendarSource,
} from "../../src/modules/onboarding/deviceCalendarImport";
import { recordCalendarScan } from "../../src/modules/onboarding/calendarConnectionStorage";
import QuickScheduleLogoLoader from "../../src/modules/schedule/components/form/QuickScheduleLogoLoader";
import { useTheme } from "../../src/modules/theme/ThemeContext";

type ScanState =
    | { status: "loading" }
    | {
        status: "ready";
        calendarCount: number;
        calendars: DeviceCalendarSource[];
        candidates: DeviceCalendarCandidate[];
        selectedCount: number;
    }
    | { status: "error"; message: string };

export default function DevCalendarImportScan() {
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const styles = useMemo(() => createStyles(), []);
    const [state, setState] = useState<ScanState>({ status: "loading" });

    useEffect(() => {
        if (!__DEV__) return;

        let cancelled = false;

        const runScan = async () => {
            try {
                if (!(await hasDeviceCalendarPermission())) {
                    setState({
                        status: "error",
                        message: "캘린더 권한이 없어 자동 스캔을 실행할 수 없습니다.",
                    });
                    return;
                }

                const summary = await loadDeviceCalendarImportSummary();
                const selectedCount = getDefaultSelectedCandidateIds(summary.candidates).size;

                await recordCalendarScan({
                    provider: getDeviceCalendarProvider(),
                    providerLabel: getCalendarProviderLabel(),
                    calendarCount: summary.calendarCount,
                    calendarNames: summary.calendarSources.map((calendar) => calendar.title),
                    eventCandidateCount: summary.candidates.length,
                });

                if (cancelled) return;

                setState({
                    status: "ready",
                    calendarCount: summary.calendarCount,
                    calendars: summary.calendarSources,
                    candidates: summary.candidates,
                    selectedCount,
                });
            } catch (error) {
                if (cancelled) return;

                setState({
                    status: "error",
                    message: error instanceof Error ? error.message : "캘린더 스캔에 실패했습니다.",
                });
            }
        };

        runScan();

        return () => {
            cancelled = true;
        };
    }, []);

    if (!__DEV__) {
        return <Redirect href="/auth/login" />;
    }

    return (
        <View
            style={[
                styles.root,
                {
                    backgroundColor: colors.background,
                    paddingTop: insets.top + 24,
                    paddingBottom: Math.max(insets.bottom, 20),
                },
            ]}
        >
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.header}>
                    <View style={[styles.icon, { backgroundColor: colors.textPrimary }]}>
                        <Ionicons name="calendar-outline" size={27} color={colors.background} />
                    </View>
                    <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>DEV QA</Text>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                        캘린더 큐레이션 스캔 결과
                    </Text>
                    <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                        실제 기기 캘린더에서 읽은 데이터로 연동 스냅샷까지 저장합니다.
                    </Text>
                </View>

                {state.status === "loading" ? (
                    <View style={styles.centerBox}>
                        <QuickScheduleLogoLoader
                            variant="calendar"
                            accessibilityLabel="캘린더를 스캔하는 중"
                        />
                        <Text style={[styles.centerText, { color: colors.textSecondary }]}>
                            캘린더를 스캔하는 중
                        </Text>
                    </View>
                ) : state.status === "error" ? (
                    <View style={[styles.noticeBox, { borderColor: colors.border }]}>
                        <Ionicons name="alert-circle-outline" size={24} color={colors.textPrimary} />
                        <Text style={[styles.noticeText, { color: colors.textPrimary }]}>
                            {state.message}
                        </Text>
                    </View>
                ) : (
                    <View style={styles.resultWrap}>
                        <View style={styles.statRow}>
                            <StatBox label="캘린더" value={`${state.calendarCount}개`} />
                            <StatBox label="후보 일정" value={`${state.candidates.length}개`} />
                            <StatBox label="기본 선택" value={`${state.selectedCount}개`} />
                        </View>

                        <Section label="연동된 캘린더">
                            {state.calendars.length > 0 ? (
                                state.calendars.map((calendar) => (
                                    <Row
                                        key={calendar.id}
                                        icon="ellipse"
                                        title={calendar.title}
                                        detail={calendar.id}
                                        color={calendar.color}
                                    />
                                ))
                            ) : (
                                <EmptyText label="표시할 캘린더가 없습니다." />
                            )}
                        </Section>

                        <Section label="후보 일정">
                            {state.candidates.length > 0 ? (
                                state.candidates.slice(0, 8).map((candidate) => (
                                    <Row
                                        key={candidate.id}
                                        icon={candidate.recommended ? "star" : "calendar-clear-outline"}
                                        title={candidate.title}
                                        detail={`${candidate.calendarTitle} · ${formatDate(candidate.startAt)}`}
                                        color={candidate.calendarColor}
                                    />
                                ))
                            ) : (
                                <EmptyText label="가져올 후보 일정이 없습니다." />
                            )}
                        </Section>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

function StatBox({ label, value }: { label: string; value: string }) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(), []);

    return (
        <View style={[styles.statBox, { borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
        </View>
    );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(), []);

    return (
        <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{label}</Text>
            <View style={styles.sectionBody}>{children}</View>
        </View>
    );
}

function Row({
    icon,
    title,
    detail,
    color,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    detail: string;
    color?: string;
}) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(), []);

    return (
        <View style={[styles.row, { borderColor: colors.border }]}>
            <Ionicons name={icon} size={18} color={color || colors.textSecondary} />
            <View style={styles.rowTextWrap}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.textPrimary }]}>
                    {title}
                </Text>
                <Text numberOfLines={1} style={[styles.rowDetail, { color: colors.textSecondary }]}>
                    {detail}
                </Text>
            </View>
        </View>
    );
}

function EmptyText({ label }: { label: string }) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(), []);

    return <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{label}</Text>;
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "시간 확인 필요";

    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(
        date.getMinutes()
    ).padStart(2, "0")}`;
}

function createStyles() {
    return StyleSheet.create({
        root: {
            flex: 1,
        },
        content: {
            paddingHorizontal: 24,
            gap: 24,
        },
        header: {
            gap: 10,
        },
        icon: {
            width: 58,
            height: 58,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
        },
        eyebrow: {
            fontSize: 12,
            fontWeight: "900",
        },
        title: {
            fontSize: 31,
            lineHeight: 38,
            fontWeight: "900",
        },
        subtitle: {
            fontSize: 15,
            lineHeight: 22,
            fontWeight: "700",
        },
        centerBox: {
            minHeight: 220,
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
        },
        centerText: {
            fontSize: 14,
            fontWeight: "800",
        },
        noticeBox: {
            minHeight: 110,
            borderWidth: 1,
            borderRadius: 16,
            padding: 18,
            gap: 12,
        },
        noticeText: {
            fontSize: 15,
            lineHeight: 22,
            fontWeight: "800",
        },
        resultWrap: {
            gap: 22,
        },
        statRow: {
            flexDirection: "row",
            gap: 10,
        },
        statBox: {
            flex: 1,
            minHeight: 76,
            borderWidth: 1,
            borderRadius: 16,
            padding: 12,
            justifyContent: "center",
            gap: 4,
        },
        statValue: {
            fontSize: 19,
            fontWeight: "900",
        },
        statLabel: {
            fontSize: 12,
            fontWeight: "800",
        },
        section: {
            gap: 9,
        },
        sectionTitle: {
            fontSize: 12,
            fontWeight: "900",
        },
        sectionBody: {
            gap: 9,
        },
        row: {
            minHeight: 64,
            borderWidth: 1,
            borderRadius: 16,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
        },
        rowTextWrap: {
            flex: 1,
            minWidth: 0,
            gap: 3,
        },
        rowTitle: {
            fontSize: 15,
            fontWeight: "900",
        },
        rowDetail: {
            fontSize: 12,
            fontWeight: "700",
        },
        emptyText: {
            fontSize: 14,
            lineHeight: 20,
            fontWeight: "800",
        },
    });
}
