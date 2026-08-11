import React from "react";
import { Pressable, Text } from "react-native";
import styles from "./ShareInvitationSheet.styles";

/** 하나의 공유 권한·기간·인원 옵션을 접근 가능한 라디오 칩으로 표시합니다. */
export function OptionChip({
    label,
    selected,
    highlight,
    borderColor,
    surfaceColor,
    textColor,
    onPress,
}: {
    label: string;
    selected: boolean;
    highlight: string;
    borderColor: string;
    surfaceColor: string;
    textColor: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.chip,
                {
                    backgroundColor: selected ? `${highlight}1E` : surfaceColor,
                    borderColor: selected ? highlight : borderColor,
                    opacity: pressed ? 0.68 : 1,
                },
            ]}
        >
            <Text style={[styles.chipText, { color: selected ? highlight : textColor }]}>
                {label}
            </Text>
        </Pressable>
    );
}
