import React, { useMemo, useState } from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ScheduleItem } from "../../types";
import { useTheme } from "../../../theme/ThemeContext";
import CalendarGlassSurface from "./CalendarGlassSurface";

type Props = {
    visible: boolean;
    items: ScheduleItem[];
    onClose: () => void;
};

function formatScheduleDateTitle(startAt: string) {
    const date = new Date(startAt);
    if (Number.isNaN(date.getTime())) return "";

    const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekdays[date.getDay()]}`;
}

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, "0");
    const meridiem = hour < 12 ? "오전" : "오후";
    const hour12 = hour % 12 || 12;
    return `${meridiem} ${hour12}:${minute}`;
}

function formatScheduleTimes(item: ScheduleItem) {
    if (item.allDay) {
        return { start: "종일", end: "" };
    }

    return {
        start: formatTime(item.startAt),
        end: item.hasEndTime === false ? "" : formatTime(item.endAt),
    };
}

export default function CalendarSearchModal({ visible, items, onClose }: Props) {
    const router = useRouter();
    const { colors, mode } = useTheme();
    const [query, setQuery] = useState("");

    const results = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase();
        if (!normalized) return [];

        return items
            .filter((item) => (
                [
                    item.title,
                    item.category?.title,
                    item.locationName,
                    item.origin?.name,
                    item.destination?.name,
                    item.notes,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLocaleLowerCase()
                    .includes(normalized)
            ))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }, [items, query]);

    const closeSearch = () => {
        setQuery("");
        onClose();
    };

    const openSchedule = (id: string) => {
        onClose();
        setQuery("");
        router.push({
            pathname: "/schedule/[id]",
            params: { id },
        });
    };

    return (
        <Modal visible={visible} animationType="fade" transparent onRequestClose={closeSearch}>
            <SafeAreaView
                style={[
                    styles.safeArea,
                    mode === "dark" ? styles.safeAreaDark : styles.safeAreaLight,
                ]}
            >
                <KeyboardAvoidingView
                    style={styles.container}
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                    <CalendarGlassSurface
                        interactive
                        clear
                        variant="toolbar"
                        style={[
                            styles.searchHeader,
                            {
                                borderBottomColor: colors.border,
                            },
                        ]}
                    >
                        <View
                            style={[
                                styles.searchField,
                                {
                                    borderColor: colors.border,
                                    backgroundColor: mode === "dark"
                                        ? "rgba(255,255,255,0.08)"
                                        : "rgba(118,118,128,0.12)",
                                },
                            ]}
                        >
                            <Ionicons name="search" size={23} color={colors.textPrimary} />
                            <TextInput
                                autoFocus
                                value={query}
                                onChangeText={setQuery}
                                placeholder="검색"
                                placeholderTextColor={colors.textSecondary}
                                returnKeyType="search"
                                selectionColor={colors.textPrimary}
                                style={[styles.input, { color: colors.textPrimary }]}
                            />
                            {query.length > 0 ? (
                                <Pressable
                                    onPress={() => setQuery("")}
                                    accessibilityLabel="검색어 지우기"
                                    style={({ pressed }) => [
                                        styles.fieldIconButton,
                                        { opacity: pressed ? 0.58 : 1 },
                                    ]}
                                >
                                    <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
                                </Pressable>
                            ) : (
                                <Ionicons name="mic-outline" size={25} color={colors.textPrimary} />
                            )}
                        </View>

                        <Pressable
                            onPress={closeSearch}
                            accessibilityLabel="검색 닫기"
                            style={({ pressed }) => [
                                styles.closeRoundButton,
                                {
                                    backgroundColor: mode === "dark"
                                        ? "rgba(255, 255, 255, 0.09)"
                                        : "rgba(255, 255, 255, 0.82)",
                                    borderColor: colors.border,
                                    opacity: pressed ? 0.62 : 1,
                                    transform: [{ scale: pressed ? 0.9 : 1 }],
                                },
                            ]}
                        >
                            <Ionicons name="close" size={31} color={colors.textPrimary} />
                        </Pressable>
                    </CalendarGlassSurface>

                    {query.trim().length === 0 ? (
                        <CalendarGlassSurface
                            variant="card"
                            style={[styles.emptyGlass, { borderColor: colors.border }]}
                        >
                            <Ionicons name="calendar-outline" size={34} color={colors.textDisabled} />
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                찾고 싶은 일정을 입력해 주세요
                            </Text>
                        </CalendarGlassSurface>
                    ) : (
                        <FlatList
                            data={results}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.results}
                            keyboardShouldPersistTaps="handled"
                            ListEmptyComponent={(
                                <CalendarGlassSurface
                                    prominent
                                    variant="card"
                                    style={[styles.emptyGlass, { borderColor: colors.border }]}
                                >
                                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                        검색 결과가 없어요
                                    </Text>
                                </CalendarGlassSurface>
                            )}
                            renderItem={({ item }) => (
                                <SearchResultRow
                                    item={item}
                                    results={results}
                                    onPress={openSchedule}
                                    colors={colors}
                                    mode={mode}
                                />
                            )}
                        />
                    )}
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

function SearchResultRow({
    item,
    results,
    onPress,
    colors,
    mode,
}: {
    item: ScheduleItem;
    results: ScheduleItem[];
    onPress: (id: string) => void;
    colors: ReturnType<typeof useTheme>["colors"];
    mode: ReturnType<typeof useTheme>["mode"];
}) {
    const index = results.findIndex((candidate) => candidate.id === item.id);
    const dateTitle = formatScheduleDateTitle(item.startAt);
    const previousDateTitle = index > 0 ? formatScheduleDateTitle(results[index - 1].startAt) : null;
    const shouldShowDate = dateTitle !== previousDateTitle;
    const times = formatScheduleTimes(item);

    return (
        <View>
            {shouldShowDate && (
                <Text style={[styles.resultDate, { color: colors.textSecondary }]}>
                    {dateTitle}
                </Text>
            )}
            <Pressable
                onPress={() => onPress(item.id)}
                style={({ pressed }) => [
                    styles.resultItem,
                    {
                        borderBottomColor: colors.border,
                        backgroundColor: pressed
                            ? mode === "dark"
                                ? "rgba(255, 255, 255, 0.08)"
                                : "rgba(118, 118, 128, 0.10)"
                            : "transparent",
                        transform: [{ scale: pressed ? 0.99 : 1 }],
                    },
                ]}
            >
                <View
                    style={[
                        styles.categoryBar,
                        { backgroundColor: item.category?.color ?? "#8e8e93" },
                    ]}
                />
                <View style={styles.resultBody}>
                    <Text
                        numberOfLines={1}
                        style={[styles.resultTitle, { color: colors.textPrimary }]}
                    >
                        {item.title}
                    </Text>
                    {!!item.locationName && (
                        <Text
                            numberOfLines={1}
                            style={[styles.resultMeta, { color: colors.textSecondary }]}
                        >
                            {item.locationName}
                        </Text>
                    )}
                </View>
                <View style={styles.timeColumn}>
                    <Text style={[styles.resultTime, { color: colors.textPrimary }]}>
                        {times.start}
                    </Text>
                    {!!times.end && (
                        <Text style={[styles.resultTimeMuted, { color: colors.textSecondary }]}>
                            {times.end}
                        </Text>
                    )}
                </View>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    safeAreaDark: {
        backgroundColor: "rgba(0, 0, 0, 0.68)",
    },
    safeAreaLight: {
        backgroundColor: "rgba(242, 242, 247, 0.62)",
    },
    container: {
        flex: 1,
    },
    searchHeader: {
        minHeight: 74,
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    searchField: {
        flex: 1,
        height: 48,
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        paddingLeft: 14,
        paddingRight: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    input: {
        flex: 1,
        fontSize: 20,
        fontWeight: "800",
        paddingVertical: 0,
    },
    fieldIconButton: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    closeRoundButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    results: {
        paddingHorizontal: 18,
        paddingTop: 20,
        paddingBottom: 220,
    },
    resultDate: {
        marginTop: 14,
        marginBottom: 8,
        fontSize: 15,
        fontWeight: "900",
    },
    resultItem: {
        minHeight: 62,
        paddingVertical: 9,
        paddingRight: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
    },
    categoryBar: {
        width: 4,
        height: 38,
        borderRadius: 2,
    },
    resultBody: {
        flex: 1,
        paddingLeft: 10,
        paddingRight: 12,
    },
    resultTitle: {
        fontSize: 18,
        fontWeight: "900",
    },
    resultMeta: {
        marginTop: 4,
        fontSize: 13,
        fontWeight: "700",
    },
    timeColumn: {
        minWidth: 82,
        alignItems: "flex-end",
    },
    resultTime: {
        fontSize: 15,
        fontWeight: "800",
    },
    resultTimeMuted: {
        marginTop: 4,
        fontSize: 15,
        fontWeight: "800",
    },
    empty: {
        flex: 1,
        minHeight: 260,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
    },
    emptyGlass: {
        minHeight: 156,
        marginHorizontal: 18,
        marginTop: 28,
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        paddingHorizontal: 20,
    },
    emptyText: {
        fontSize: 14,
    },
});
