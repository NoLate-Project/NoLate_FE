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

type Props = {
    visible: boolean;
    items: ScheduleItem[];
    onClose: () => void;
};

function formatScheduleDate(startAt: string) {
    const date = new Date(startAt);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export default function CalendarSearchModal({ visible, items, onClose }: Props) {
    const router = useRouter();
    const { colors } = useTheme();
    const [query, setQuery] = useState("");

    const results = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase();
        if (!normalized) return [];

        return items.filter((item) => (
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
        ));
    }, [items, query]);

    const openSchedule = (id: string) => {
        onClose();
        setQuery("");
        router.push({
            pathname: "/schedule/[id]",
            params: { id },
        });
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
                <KeyboardAvoidingView
                    style={styles.container}
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                    <View style={styles.header}>
                        <Text style={[styles.title, { color: colors.textPrimary }]}>일정 검색</Text>
                        <Pressable onPress={onClose} style={styles.closeButton}>
                            <Text style={[styles.closeText, { color: colors.textPrimary }]}>완료</Text>
                        </Pressable>
                    </View>

                    <View style={[styles.searchField, { backgroundColor: colors.surface2 }]}>
                        <Ionicons name="search" size={19} color={colors.textSecondary} />
                        <TextInput
                            autoFocus
                            value={query}
                            onChangeText={setQuery}
                            placeholder="제목, 카테고리, 장소 검색"
                            placeholderTextColor={colors.textSecondary}
                            returnKeyType="search"
                            style={[styles.input, { color: colors.textPrimary }]}
                        />
                        {query.length > 0 && (
                            <Pressable onPress={() => setQuery("")}>
                                <Ionicons name="close-circle" size={19} color={colors.textSecondary} />
                            </Pressable>
                        )}
                    </View>

                    {query.trim().length === 0 ? (
                        <View style={styles.empty}>
                            <Ionicons name="calendar-outline" size={34} color={colors.textDisabled} />
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                찾고 싶은 일정을 입력해 주세요
                            </Text>
                        </View>
                    ) : (
                        <FlatList
                            data={results}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.results}
                            keyboardShouldPersistTaps="handled"
                            ListEmptyComponent={(
                                <View style={styles.empty}>
                                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                        검색 결과가 없어요
                                    </Text>
                                </View>
                            )}
                            renderItem={({ item }) => (
                                <Pressable
                                    onPress={() => openSchedule(item.id)}
                                    style={({ pressed }) => [
                                        styles.resultItem,
                                        {
                                            backgroundColor: pressed
                                                ? colors.surface2
                                                : colors.surface,
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
                                        <Text style={[styles.resultMeta, { color: colors.textSecondary }]}>
                                            {formatScheduleDate(item.startAt)}
                                            {item.category?.title ? ` · ${item.category.title}` : ""}
                                        </Text>
                                    </View>
                                    <Ionicons
                                        name="chevron-forward"
                                        size={18}
                                        color={colors.textSecondary}
                                    />
                                </Pressable>
                            )}
                        />
                    )}
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    container: {
        flex: 1,
    },
    header: {
        minHeight: 56,
        paddingHorizontal: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    title: {
        fontSize: 22,
        fontWeight: "800",
    },
    closeButton: {
        minHeight: 38,
        justifyContent: "center",
        paddingHorizontal: 6,
    },
    closeText: {
        fontSize: 15,
        fontWeight: "700",
    },
    searchField: {
        height: 44,
        marginHorizontal: 16,
        borderRadius: 13,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    input: {
        flex: 1,
        fontSize: 16,
        paddingVertical: 0,
    },
    results: {
        padding: 16,
        gap: 9,
    },
    resultItem: {
        minHeight: 68,
        borderRadius: 16,
        paddingRight: 14,
        overflow: "hidden",
        flexDirection: "row",
        alignItems: "center",
    },
    categoryBar: {
        width: 4,
        alignSelf: "stretch",
    },
    resultBody: {
        flex: 1,
        paddingHorizontal: 13,
    },
    resultTitle: {
        fontSize: 15,
        fontWeight: "700",
    },
    resultMeta: {
        marginTop: 5,
        fontSize: 12,
    },
    empty: {
        flex: 1,
        minHeight: 260,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
    },
    emptyText: {
        fontSize: 14,
    },
});
