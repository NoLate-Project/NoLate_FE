import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import ReanimatedSwipeable, {
    type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import type { ScheduleItem } from "../types";

export type ScheduleSwipeActionCallbacks = {
    onEdit?: () => void;
    onDelete?: () => void;
};

export type ScheduleSwipeActionResolver = (
    item: ScheduleItem,
) => ScheduleSwipeActionCallbacks | undefined;

type Props = ScheduleSwipeActionCallbacks & {
    children: React.ReactNode;
    itemTitle: string;
    containerStyle?: StyleProp<ViewStyle>;
    childrenContainerStyle?: StyleProp<ViewStyle>;
    compact?: boolean;
};

let openedSwipeable: SwipeableMethods | null = null;

/**
 * 일정 카드의 trailing swipe 영역을 통일한다.
 * 한 번에 한 행만 열고, 삭제는 전달받은 확인 흐름을 그대로 호출한다.
 */
export default function ScheduleSwipeActions({
    children,
    itemTitle,
    onEdit,
    onDelete,
    containerStyle,
    childrenContainerStyle,
    compact = false,
}: Props) {
    const swipeableRef = useRef<SwipeableMethods>(null);
    const [actionsVisibleToAccessibility, setActionsVisibleToAccessibility] = useState(false);
    const enabled = Boolean(onEdit || onDelete);

    useEffect(
        () => () => {
            if (openedSwipeable === swipeableRef.current) {
                openedSwipeable = null;
            }
        },
        [],
    );

    const handleWillOpen = useCallback(() => {
        const current = swipeableRef.current;
        if (openedSwipeable && openedSwipeable !== current) {
            openedSwipeable.close();
        }
        openedSwipeable = current;
        setActionsVisibleToAccessibility(true);
    }, []);

    const handleClose = useCallback(() => {
        if (openedSwipeable === swipeableRef.current) {
            openedSwipeable = null;
        }
        setActionsVisibleToAccessibility(false);
    }, []);

    const renderRightActions = useCallback(
        (
            _progress: unknown,
            _translation: unknown,
            methods: SwipeableMethods,
        ) => {
            const run = (action?: () => void) => {
                methods.close();
                action?.();
            };

            return (
                <View
                    accessibilityElementsHidden={!actionsVisibleToAccessibility}
                    importantForAccessibility={
                        actionsVisibleToAccessibility ? "auto" : "no-hide-descendants"
                    }
                    style={styles.actions}
                >
                    {onEdit ? (
                        <Pressable
                            testID="schedule-swipe-edit-action"
                            accessibilityRole="button"
                            accessibilityLabel={`${itemTitle} 수정`}
                            onPress={() => run(onEdit)}
                            style={({ pressed }) => [
                                styles.action,
                                compact && styles.actionCompact,
                                styles.editAction,
                                pressed && styles.actionPressed,
                            ]}
                        >
                            <Ionicons
                                accessible={false}
                                name="pencil-outline"
                                size={compact ? 16 : 18}
                                color="#FFFFFF"
                            />
                            <Text style={styles.actionLabel}>수정</Text>
                        </Pressable>
                    ) : null}
                    {onDelete ? (
                        <Pressable
                            testID="schedule-swipe-delete-action"
                            accessibilityRole="button"
                            accessibilityLabel={`${itemTitle} 삭제`}
                            onPress={() => run(onDelete)}
                            style={({ pressed }) => [
                                styles.action,
                                compact && styles.actionCompact,
                                styles.deleteAction,
                                pressed && styles.actionPressed,
                            ]}
                        >
                            <Ionicons
                                accessible={false}
                                name="trash-outline"
                                size={compact ? 16 : 18}
                                color="#FFFFFF"
                            />
                            <Text style={styles.actionLabel}>삭제</Text>
                        </Pressable>
                    ) : null}
                </View>
            );
        },
        [actionsVisibleToAccessibility, compact, itemTitle, onDelete, onEdit],
    );

    return (
        <ReanimatedSwipeable
            ref={swipeableRef}
            enabled={enabled}
            friction={1.7}
            rightThreshold={compact ? 44 : 52}
            dragOffsetFromRightEdge={14}
            overshootRight={false}
            enableTrackpadTwoFingerGesture
            renderRightActions={enabled ? renderRightActions : undefined}
            onSwipeableWillOpen={handleWillOpen}
            onSwipeableClose={handleClose}
            containerStyle={[styles.container, containerStyle]}
            childrenContainerStyle={childrenContainerStyle}
        >
            {children}
        </ReanimatedSwipeable>
    );
}

const styles = StyleSheet.create({
    container: {
        overflow: "hidden",
    },
    actions: {
        height: "100%",
        flexDirection: "row",
        alignItems: "stretch",
    },
    action: {
        width: 62,
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    actionCompact: {
        width: 46,
    },
    editAction: {
        backgroundColor: "#5E5CE6",
    },
    deleteAction: {
        backgroundColor: "#FF3B30",
    },
    actionPressed: {
        opacity: 0.72,
    },
    actionLabel: {
        color: "#FFFFFF",
        fontSize: 11,
        lineHeight: 14,
        fontWeight: "800",
    },
});
