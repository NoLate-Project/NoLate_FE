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

import ViewModeGlassControl from "../../src/modules/schedule/components/calendar/ViewModeGlassControl";
import LiquidCalendarMenuPrototype, {
    isCalendarViewMode,
    isLiquidCalendarMenuPrototypeAvailable,
} from "../../src/modules/schedule/components/calendar/LiquidCalendarMenuPrototype";
import NativeViewModeGlassControl from "../../src/modules/schedule/components/calendar/ViewModeGlassControl/NativeViewModeGlassControl";
import type {
    ViewModeGlassControlOpenChangeEvent,
    ViewModeGlassControlSelectEvent,
} from "../../src/modules/schedule/components/calendar/ViewModeGlassControl";
import type { CalendarViewMode } from "../../src/modules/schedule/components/calendar/viewMode";

const TEST_MODES: CalendarViewMode[] = ["compact", "stack", "detail", "list"];

export default function ViewModeGlassControlDevRoute() {
    const insets = useSafeAreaInsets();
    const [selectedMode, setSelectedMode] = useState<CalendarViewMode>("stack");
    const [lastSelect, setLastSelect] = useState("none");
    const [lastOpenChange, setLastOpenChange] = useState("none");
    const [disabled, setDisabled] = useState(false);

    const nativeAvailable = Platform.OS === "ios" && Boolean(NativeViewModeGlassControl);

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

    const handleSelect = useCallback((mode: CalendarViewMode) => {
        setSelectedMode(mode);
        setLastSelect(mode);
        console.log("[ViewModeGlassControl dev] onSelect", mode);
    }, []);

    const handleOpenChange = useCallback((open: boolean) => {
        setLastOpenChange(open ? "open" : "closed");
        console.log("[ViewModeGlassControl dev] onOpenChange", open);
    }, []);

    const handleNativeSelect = useCallback(
        (event: NativeSyntheticEvent<ViewModeGlassControlSelectEvent>) => {
            const nextMode = event.nativeEvent.mode;
            if (TEST_MODES.includes(nextMode)) {
                handleSelect(nextMode);
            }
        },
        [handleSelect],
    );

    const handleNativeOpenChange = useCallback(
        (event: NativeSyntheticEvent<ViewModeGlassControlOpenChangeEvent>) => {
            handleOpenChange(Boolean(event.nativeEvent.open));
        },
        [handleOpenChange],
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
            <Text style={styles.title}>Native ViewModeGlassControl Dev Test</Text>
            <Text style={styles.description}>
                This route keeps the existing control intact and adds an isolated
                LiquidCalendarMenuPrototype for validating the Apple Calendar style
                surface morph hierarchy.
            </Text>

            <View style={styles.controls}>
                <View style={styles.modeGrid}>{selectedModeButtons}</View>
                <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: disabled }}
                    onPress={() => setDisabled((next) => !next)}
                    style={[styles.toggleButton, disabled && styles.toggleButtonActive]}
                >
                    <Text style={styles.toggleButtonText}>
                        disabled: {disabled ? "true" : "false"}
                    </Text>
                </Pressable>
            </View>

            <View style={styles.statusCard}>
                <Text style={styles.statusText}>Platform: {Platform.OS}</Text>
                <Text style={styles.statusText}>
                    Native component: {nativeAvailable ? "available" : "unavailable"}
                </Text>
                <Text style={styles.statusText}>
                    Liquid prototype:{" "}
                    {isLiquidCalendarMenuPrototypeAvailable
                        ? "available"
                        : "unavailable"}
                </Text>
                <Text style={styles.statusText}>selectedMode prop: {selectedMode}</Text>
                <Text style={styles.statusText}>last onSelect: {lastSelect}</Text>
                <Text style={styles.statusText}>last onOpenChange: {lastOpenChange}</Text>
            </View>

            <View style={styles.prototypeSection}>
                <Text style={styles.sectionTitle}>LiquidCalendarMenuPrototype</Text>
                <Text style={styles.sectionDescription}>
                    Independent hierarchy test: one top-trailing liquid object owns the
                    collapsed button, morphing surface, readability layer, and delayed
                    rows.
                </Text>
                <View style={styles.prototypeStage}>
                    {isLiquidCalendarMenuPrototypeAvailable ? (
                        <LiquidCalendarMenuPrototype
                            selectedMode={selectedMode}
                            disabled={disabled}
                            colorScheme="dark"
                            onSelect={(mode) => {
                                if (isCalendarViewMode(mode)) {
                                    handleSelect(mode);
                                }
                            }}
                            onOpenChange={handleOpenChange}
                            style={styles.prototypeControl}
                        />
                    ) : (
                        <Text style={styles.unavailableText}>
                            LiquidCalendarMenuPrototype is not available on this runtime.
                        </Text>
                    )}
                </View>
            </View>

            <Text style={styles.sectionTitle}>Existing ViewModeGlassControl</Text>
            <View style={styles.previewStage}>
                {nativeAvailable ? (
                    <ViewModeGlassControl
                        selectedMode={selectedMode}
                        disabled={disabled}
                        colorScheme="dark"
                        onSelect={handleSelect}
                        onOpenChange={handleOpenChange}
                        style={styles.nativeControl}
                    />
                ) : (
                    <Text style={styles.unavailableText}>
                        Native ViewModeGlassControl is not available on this runtime.
                    </Text>
                )}
            </View>

            <View style={styles.rawNativeStage}>
                <Text style={styles.rawNativeTitle}>Raw native bridge event check</Text>
                {nativeAvailable && NativeViewModeGlassControl ? (
                    <NativeViewModeGlassControl
                        selectedMode={selectedMode}
                        disabled={disabled}
                        colorScheme="dark"
                        onSelect={handleNativeSelect}
                        onOpenChange={handleNativeOpenChange}
                        style={styles.rawNativeControl}
                    />
                ) : null}
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
    modeGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },
    modeButton: {
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.12)",
        borderColor: "rgba(255,255,255,0.18)",
        borderRadius: 18,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 50,
        minWidth: 100,
        paddingHorizontal: 14,
    },
    modeButtonSelected: {
        backgroundColor: "rgba(255,255,255,0.24)",
        borderColor: "rgba(255,255,255,0.34)",
    },
    modeButtonText: {
        color: "#fff",
        fontSize: 15,
        fontWeight: "800",
    },
    toggleButton: {
        alignItems: "center",
        alignSelf: "flex-start",
        backgroundColor: "rgba(255,255,255,0.1)",
        borderColor: "rgba(255,255,255,0.18)",
        borderRadius: 18,
        borderWidth: 1,
        justifyContent: "center",
        minHeight: 48,
        paddingHorizontal: 18,
    },
    toggleButtonActive: {
        backgroundColor: "rgba(255,255,255,0.22)",
    },
    toggleButtonText: {
        color: "#fff",
        fontSize: 15,
        fontWeight: "800",
    },
    statusCard: {
        backgroundColor: "rgba(255,255,255,0.08)",
        borderColor: "rgba(255,255,255,0.14)",
        borderRadius: 20,
        borderWidth: 1,
        gap: 6,
        padding: 16,
    },
    statusText: {
        color: "rgba(255,255,255,0.8)",
        fontSize: 14,
        fontWeight: "700",
    },
    prototypeSection: {
        gap: 10,
    },
    sectionTitle: {
        color: "rgba(255,255,255,0.86)",
        fontSize: 15,
        fontWeight: "900",
        textTransform: "uppercase",
    },
    sectionDescription: {
        color: "rgba(255,255,255,0.62)",
        fontSize: 13,
        lineHeight: 18,
    },
    prototypeStage: {
        alignItems: "flex-end",
        minHeight: 336,
        overflow: "visible",
    },
    prototypeControl: {
        height: 296,
        width: 292,
    },
    previewStage: {
        alignItems: "flex-end",
        minHeight: 336,
        overflow: "visible",
    },
    nativeControl: {
        height: 296,
        width: 292,
    },
    unavailableText: {
        color: "rgba(255,255,255,0.7)",
        fontSize: 15,
        lineHeight: 21,
    },
    rawNativeStage: {
        gap: 10,
        minHeight: 160,
    },
    rawNativeTitle: {
        color: "rgba(255,255,255,0.58)",
        fontSize: 13,
        fontWeight: "800",
        textTransform: "uppercase",
    },
    rawNativeControl: {
        alignSelf: "flex-end",
        height: 296,
        width: 292,
    },
});
