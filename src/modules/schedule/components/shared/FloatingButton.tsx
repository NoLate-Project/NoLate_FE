import React from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../theme/ThemeContext";

// 새 일정 추가 액션을 실행하는 플로팅 버튼을 표시한다.
export default function FloatingButton({ onPress, bottomInset = 0 }: { onPress: () => void; bottomInset?: number }) {
    const { colors } = useTheme();

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => ({
                position: "absolute",
                right: 20,
                bottom: Math.max(24, bottomInset + 12),
                width: 58,
                height: 58,
                borderRadius: 29,
                backgroundColor: pressed ? colors.surface2 : colors.selectedDayBg,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25,
                shadowRadius: 8,
                elevation: 8,
            })}
        >
            <Ionicons name="add" size={31} color={colors.selectedDayText} />
        </Pressable>
    );
}
