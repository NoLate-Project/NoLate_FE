import React from "react";
import { Pressable, Text } from "react-native";
import { useTheme } from "../../../../src/modules/theme/ThemeContext";

export default function FloatingButton({ onPress }: { onPress: () => void }) {
    const { colors } = useTheme();

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => ({
                position: "absolute",
                right: 20,
                bottom: 32,
                width: 52,
                height: 52,
                borderRadius: 26,
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
            <Text
                style={{
                    color: colors.selectedDayText,
                    fontSize: 24,
                    fontWeight: "300",
                    lineHeight: 26,
                }}
            >
                +
            </Text>
        </Pressable>
    );
}
