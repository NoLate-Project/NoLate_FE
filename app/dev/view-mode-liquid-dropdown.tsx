import React, { useCallback, useMemo, useState } from "react";
import {
    NativeSyntheticEvent,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import NativeViewModeLiquidDropdown from "../../src/modules/schedule/components/calendar/ViewModeDropdown/NativeViewModeLiquidDropdown";
import type {
    ViewModeDropdownCloseEvent,
    ViewModeDropdownSelectEvent,
} from "../../src/modules/schedule/components/calendar/ViewModeDropdown/types";
import type { CalendarViewMode } from "../../src/modules/schedule/components/calendar/viewMode";

const TEST_MODES: CalendarViewMode[] = ["compact", "stack", "detail", "list"];

export default function ViewModeLiquidDropdownDevRoute() {
    const insets = useSafeAreaInsets();
    const [visible, setVisible] = useState(true);
    const [selectedMode, setSelectedMode] = useState<CalendarViewMode>("stack");
    const [lastSelect, setLastSelect] = useState("none");
    const [lastClose, setLastClose] = useState("none");

    const nativeAvailable = Platform.OS === "ios" && Boolean(NativeViewModeLiquidDropdown);
    const NativeDropdown = NativeViewModeLiquidDropdown;

    const handleSelect = useCallback(
        (event: NativeSyntheticEvent<ViewModeDropdownSelectEvent>) => {
            const nextMode = event.nativeEvent.mode;
            setLastSelect(nextMode);
            if (TEST_MODES.includes(nextMode)) {
                setSelectedMode(nextMode);
            }
            console.log("[ViewModeLiquidDropdown dev] onSelect", nextMode);
        },
        [],
    );

    const handleClose = useCallback(
        (event: NativeSyntheticEvent<ViewModeDropdownCloseEvent>) => {
            const reason = event.nativeEvent.reason ?? "unknown";
            setLastClose(reason);
            if (reason === "close") {
                setVisible(false);
            }
            console.log("[ViewModeLiquidDropdown dev] onClose", reason);
        },
        [],
    );

    const selectedModeButtons = useMemo(
        () => TEST_MODES.map((mode) => (
            <Pressable
                key={mode}
                accessibilityRole="button"
                onPress={() => setSelectedMode(mode)}
                style={[
                    styles.modeButton,
                    selectedMode === mode && styles.modeButtonSelected,
                ]}
            >
                <Text style={styles.modeButtonText}>{mode}</Text>
            </Pressable>
        )),
        [selectedMode],
    );

    if (!__DEV__) {
        return <Redirect href="/" />;
    }

    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={[
                styles.content,
                {
                    paddingTop: insets.top + 24,
                    paddingBottom: insets.bottom + 32,
                },
            ]}
        >
            <Text style={styles.title}>Native ViewModeDropdown Dev Test</Text>
            <Text style={styles.description}>
                This route does not replace the Calendar view dropdown. It only verifies
                native render, props, and event bridge.
            </Text>

            <View style={styles.controls}>
                <Pressable
                    accessibilityRole="button"
                    onPress={() => setVisible((next) => !next)}
                    style={styles.primaryButton}
                >
                    <Text style={styles.primaryButtonText}>
                        visible: {visible ? "true" : "false"}
                    </Text>
                </Pressable>
                <View style={styles.modeGrid}>{selectedModeButtons}</View>
            </View>

            <View style={styles.statusCard}>
                <Text style={styles.statusText}>Platform: {Platform.OS}</Text>
                <Text style={styles.statusText}>
                    Native component: {nativeAvailable ? "available" : "unavailable"}
                </Text>
                <Text style={styles.statusText}>selectedMode prop: {selectedMode}</Text>
                <Text style={styles.statusText}>last onSelect: {lastSelect}</Text>
                <Text style={styles.statusText}>last onClose: {lastClose}</Text>
            </View>

            <View style={styles.previewStage}>
                {nativeAvailable && NativeDropdown ? (
                    <NativeDropdown
                        visible={visible}
                        selectedMode={selectedMode}
                        onSelect={handleSelect}
                        onClose={handleClose}
                        style={styles.nativeDropdown}
                    />
                ) : (
                    <Text style={styles.unavailableText}>
                        Native ViewModeLiquidDropdown is not available on this runtime.
                    </Text>
                )}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: "#050506",
    },
    content: {
        paddingHorizontal: 20,
        gap: 18,
    },
    title: {
        color: "#fff",
        fontSize: 24,
        fontWeight: "800",
    },
    description: {
        color: "rgba(255,255,255,0.72)",
        fontSize: 14,
        lineHeight: 20,
    },
    controls: {
        gap: 12,
    },
    primaryButton: {
        alignSelf: "flex-start",
        borderRadius: 18,
        backgroundColor: "rgba(255,255,255,0.16)",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    primaryButtonText: {
        color: "#fff",
        fontSize: 15,
        fontWeight: "800",
    },
    modeGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },
    modeButton: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.18)",
        paddingHorizontal: 13,
        paddingVertical: 10,
    },
    modeButtonSelected: {
        backgroundColor: "rgba(255,255,255,0.18)",
        borderColor: "rgba(255,255,255,0.42)",
    },
    modeButtonText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "700",
    },
    statusCard: {
        borderRadius: 18,
        backgroundColor: "rgba(255,255,255,0.08)",
        padding: 16,
        gap: 8,
    },
    statusText: {
        color: "rgba(255,255,255,0.82)",
        fontSize: 14,
        fontWeight: "600",
    },
    previewStage: {
        height: 320,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        backgroundColor: "rgba(255,255,255,0.04)",
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
    },
    nativeDropdown: {
        width: 270,
        height: 288,
    },
    unavailableText: {
        color: "rgba(255,255,255,0.68)",
        fontSize: 14,
        textAlign: "center",
        paddingHorizontal: 24,
    },
});
