import React, { ReactNode } from "react";
import { Pressable, View } from "react-native";

type Props = {
    children: ReactNode;
    style?: any;
};

const baseStyle = {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 16,
    backgroundColor: "#fff",
    overflow: "hidden" as const,
};

export default function Card({ children, style }: Props) {
    return <View style={[baseStyle, style]}>{children}</View>;
}

export function CardPress({
                              children,
                              style,
                              onPress,
                          }: Props & { onPress?: () => void }) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                baseStyle,
                style,
                pressed && { opacity: 0.85 },
            ]}
        >
            {children}
        </Pressable>
    );
}