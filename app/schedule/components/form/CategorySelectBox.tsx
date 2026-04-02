import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useTheme } from "../../../../src/modules/theme/ThemeContext";

export type ScheduleCategory = {
    id: string;
    title: string;
    color: string;
};

type Props = {
    label?: string;
    categories: ScheduleCategory[];
    value: string;
    onChange: (id: string) => void;
};

const ITEM_HEIGHT = 49; // 아이템 1개 높이 (paddingVertical 12*2 + 텍스트 ~25)

export default function CategorySelectBox({
    label = "카테고리",
    categories,
    value, 
    onChange,
}: Props) {
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);

    const expandAnim  = useRef(new Animated.Value(0)).current;
    const prevOpenRef = useRef(false);

    useEffect(() => {
        const wasOpen = prevOpenRef.current;
        prevOpenRef.current = open;

        if (open && !wasOpen) {
            // 열기 — 스프링
            Animated.spring(expandAnim, {
                toValue: 1,
                useNativeDriver: false,
                damping: 18,
                stiffness: 160,
                mass: 0.8,
            }).start();
        } else if (!open && wasOpen) {
            // 닫기 — timing
            Animated.timing(expandAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: false,
            }).start();
        }
    }, [open, expandAnim]);

    // 드롭다운 높이
    const listMaxHeight = expandAnim.interpolate({
        inputRange:  [0, 1],
        outputRange: [0, ITEM_HEIGHT * categories.length],
    });

    // 화살표 회전 (▼ → ▲)
    const arrowRotate = expandAnim.interpolate({
        inputRange:  [0, 1],
        outputRange: ["0deg", "180deg"],
    });

    const selected = useMemo(
        () => categories.find((c) => c.id === value),
        [categories, value]
    );

    return (
        <View style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.textSecondary, marginBottom: 6, fontSize: 13 }}>
                {label}
            </Text>

            {/* 선택 버튼 */}
            <Pressable
                onPress={() => setOpen((v) => !v)}
                style={{
                    borderWidth: 1,
                    borderColor: open ? colors.selectedDayBg : colors.border,
                    borderRadius: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: colors.surface2,
                }}
            >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: selected?.color ?? "#bbb" }} />
                    <Text style={{ fontWeight: "700", color: colors.textPrimary }}>
                        {selected?.title ?? "선택"}
                    </Text>
                </View>

                {/* 회전하는 화살표 */}
                <Animated.Text style={{
                    color: colors.textSecondary,
                    fontSize: 11,
                    transform: [{ rotate: arrowRotate }],
                }}>
                    ▼
                </Animated.Text>
            </Pressable>

            {/* 드롭다운 목록 — 애니메이션 */}
            <Animated.View style={{
                maxHeight: listMaxHeight,
                opacity:   expandAnim,
                overflow:  "hidden",
            }}>
                <View style={{
                    marginTop: 6,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    overflow: "hidden",
                    backgroundColor: colors.surface,
                }}>
                    {categories.map((c, idx) => {
                        const active = c.id === value;
                        return (
                            <Pressable
                                key={c.id}
                                onPress={() => { onChange(c.id); setOpen(false); }}
                                style={{
                                    paddingVertical: 12,
                                    paddingHorizontal: 12,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    backgroundColor: active ? colors.surface2 : colors.surface,
                                    borderTopWidth: idx === 0 ? 0 : 1,
                                    borderTopColor: colors.border,
                                }}
                            >
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.color }} />
                                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.textPrimary }}>
                                        {c.title}
                                    </Text>
                                </View>
                                <Text style={{ fontSize: 15, color: active ? colors.textPrimary : "transparent" }}>✓</Text>
                            </Pressable>
                        );
                    })}
                </View>
            </Animated.View>
        </View>
    );
}
