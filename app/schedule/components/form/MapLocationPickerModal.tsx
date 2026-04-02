import React, { useEffect, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "../../../../src/modules/theme/ThemeContext";
import NaverMapPreview from "../../../../src/modules/map/NaverMapPreview";
import { getCurrentLocation } from "../../../../src/modules/map/currentLocation";

type PlaceValue = {
    name: string;
    lat?: number;
    lng?: number;
};

type Props = {
    visible: boolean;
    title: string;
    initialValue?: PlaceValue;
    onClose: () => void;
    onConfirm: (value: PlaceValue) => void;
};

export default function MapLocationPickerModal({ visible, title, initialValue, onClose, onConfirm }: Props) {
    const { colors } = useTheme();
    const [name, setName] = useState(initialValue?.name ?? "");
    const [lat, setLat] = useState<number | undefined>(initialValue?.lat);
    const [lng, setLng] = useState<number | undefined>(initialValue?.lng);

    useEffect(() => {
        if (!visible) return;
        setName(initialValue?.name ?? "");
        setLat(initialValue?.lat);
        setLng(initialValue?.lng);
    }, [visible, initialValue?.name, initialValue?.lat, initialValue?.lng]);

    const useMyLocation = async () => {
        try {
            const loc = await getCurrentLocation();
            setLat(loc.latitude);
            setLng(loc.longitude);
            if (!name.trim()) setName("현재 위치");
        } catch (error) {
            const message = error instanceof Error ? error.message : "현재 위치를 가져오지 못했습니다.";
            Alert.alert("위치 가져오기 실패", message);
        }
    };

    const submit = () => {
        onConfirm({ name: name.trim(), lat, lng });
        onClose();
    };

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={styles.row}>
                        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
                        <Pressable onPress={onClose}>
                            <Text style={[styles.close, { color: colors.textSecondary }]}>닫기</Text>
                        </Pressable>
                    </View>

                    <NaverMapPreview lat={lat} lng={lng} height={220} />

                    <Pressable onPress={useMyLocation} style={[styles.myLocBtn, { borderColor: colors.border, backgroundColor: colors.surface2 }]}>
                        <Text style={[styles.myLocText, { color: colors.textPrimary }]}>내 위치 사용</Text>
                    </Pressable>

                    <TextInput
                        value={name}
                        onChangeText={setName}
                        placeholder="장소 이름"
                        placeholderTextColor={colors.textDisabled}
                        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface2, color: colors.textPrimary }]}
                    />

                    <Pressable onPress={submit} style={[styles.confirmBtn, { backgroundColor: colors.selectedDayBg }]}>
                        <Text style={[styles.confirmText, { color: colors.selectedDayText }]}>선택 완료</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "flex-end",
    },
    sheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderWidth: 1,
        borderBottomWidth: 0,
        padding: 16,
        gap: 10,
    },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    title: {
        fontSize: 16,
        fontWeight: "700",
    },
    close: {
        fontSize: 13,
        fontWeight: "600",
    },
    myLocBtn: {
        minHeight: 38,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    myLocText: {
        fontSize: 13,
        fontWeight: "700",
    },
    input: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    confirmBtn: {
        minHeight: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 2,
    },
    confirmText: {
        fontWeight: "700",
        fontSize: 14,
    },
});
