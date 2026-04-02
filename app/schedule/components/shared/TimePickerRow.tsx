import { useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";

const pad2 = (n: number) => String(n).padStart(2, "0");
const toHHmm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

type Props = {
    startDate: Date;
    endDate: Date;
    onChangeStart: (d: Date) => void;
    onChangeEnd: (d: Date) => void;
};

export default function TimePickerRow({ startDate, endDate, onChangeStart, onChangeEnd }: Props) {
    const [pickerTarget, setPickerTarget] = useState<"start" | "end" | null>(null);

    const startText = useMemo(() => toHHmm(startDate), [startDate]);
    const endText = useMemo(() => toHHmm(endDate), [endDate]);

    const onChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === "android") {
            if (event.type === "dismissed") {
                setPickerTarget(null);
                return;
            }
            if (!selected) return;

            if (pickerTarget === "start") {
                onChangeStart(selected);
                if (endDate.getTime() <= selected.getTime()) {
                    const e = new Date(selected);
                    e.setMinutes(e.getMinutes() + 30);
                    onChangeEnd(e);
                }
            } else if (pickerTarget === "end") {
                onChangeEnd(selected);
            }
            setPickerTarget(null);
            return;
        }

        if (!selected) return;
        if (pickerTarget === "start") {
            onChangeStart(selected);
            if (endDate.getTime() <= selected.getTime()) {
                const e = new Date(selected);
                e.setMinutes(e.getMinutes() + 30);
                onChangeEnd(e);
            }
        } else if (pickerTarget === "end") {
            onChangeEnd(selected);
        }
    };

    return (
        <View style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: "#666", marginBottom: 6 }}>시작</Text>
                    <Pressable
                        onPress={() => setPickerTarget("start")}
                        style={{
                            borderWidth: 1,
                            borderColor: "#eee",
                            borderRadius: 12,
                            paddingVertical: 12,
                            paddingHorizontal: 12,
                        }}
                    >
                        <Text style={{ fontWeight: "800", color: "#111" }}>{startText}</Text>
                    </Pressable>
                </View>

                <View style={{ flex: 1 }}>
                    <Text style={{ color: "#666", marginBottom: 6 }}>종료</Text>
                    <Pressable
                        onPress={() => setPickerTarget("end")}
                        style={{
                            borderWidth: 1,
                            borderColor: "#eee",
                            borderRadius: 12,
                            paddingVertical: 12,
                            paddingHorizontal: 12,
                        }}
                    >
                        <Text style={{ fontWeight: "800", color: "#111" }}>{endText}</Text>
                    </Pressable>
                </View>
            </View>

            {pickerTarget !== null && (
                <View style={{ marginTop: 12 }}>
                    <DateTimePicker
                        value={pickerTarget === "start" ? startDate : endDate}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        is24Hour
                        onChange={onChange}
                    />

                    {Platform.OS === "ios" && (
                        <View style={{ alignItems: "flex-end", marginTop: 8 }}>
                            <Pressable
                                onPress={() => setPickerTarget(null)}
                                style={{
                                    paddingVertical: 8,
                                    paddingHorizontal: 12,
                                    borderRadius: 12,
                                    backgroundColor: "#eee",
                                }}
                            >
                                <Text style={{ fontWeight: "800" }}>완료</Text>
                            </Pressable>
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}