import React, { useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

// Observed in Korail's official web bundle (2026-10-12), including its spelling.
// This main-screen bridge is best-effort, not a published booking/prefill contract.
// Do not append itinerary, account or ticket data to either URL.
export const TRAIN_BOOKING_APP_URL = 'korailtalk://gotoMainViewContoller';
export const TRAIN_BOOKING_URL = 'https://www.korail.com/';

async function openOfficialBooking(appURL: string | undefined, webURL: string) {
    try {
        if (appURL && await Linking.canOpenURL(appURL)) {
            await Linking.openURL(appURL);
            return;
        }
    } catch {
        // Query or launch failure must still leave a working official web entry.
    }
    await Linking.openURL(webURL);
}

/** Opens the official service without changing the route or its booking status. */
export function OfficialBookingAction({ dark = false, appURL, webURL, name, label, note }: {
    dark?: boolean; appURL?: string; webURL: string; name: string; label: string; note: string;
}) {
    const opening = useRef(false);
    const [pending, setPending] = useState(false);
    const open = async () => {
        if (opening.current) return;
        opening.current = true;
        setPending(true);
        try {
            // Keep NoLate's current screen and draft in place for the return trip.
            await openOfficialBooking(appURL, webURL);
        } catch {
            Alert.alert('예매 페이지를 열지 못했어요', '연결을 확인한 뒤 다시 시도해 주세요. 현재 경로는 유지됩니다.', [
                { text: '닫기', style: 'cancel' },
                { text: '다시 시도', onPress: open },
            ]);
        } finally {
            opening.current = false;
            setPending(false);
        }
    };
    if (Platform.OS !== 'ios') return null;
    const buttonStyle = { backgroundColor: dark ? '#193357' : '#EAF2FF', opacity: pending ? 0.5 : 1 };
    const labelStyle = { color: dark ? '#9FC8FF' : '#1855AD' };
    const noteStyle = { color: dark ? '#B1B8C4' : '#536176' };
    return <View style={styles.container}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${name} 공식 예매 열기`}
            accessibilityHint={note}
            accessibilityState={{ busy: pending, disabled: pending }} disabled={pending}
            onPress={open}
            style={[styles.button, buttonStyle]}>
            <Text style={[styles.label, labelStyle]}>{label} ↗</Text>
        </Pressable>
        <Text style={[styles.note, noteStyle]}>{note}</Text>
    </View>;
}

const styles = StyleSheet.create({
    container: { gap: 6 },
    button: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
    label: { fontSize: 15, fontWeight: '600' },
    note: { fontSize: 12, lineHeight: 18 },
});

export default function TrainBookingAction({ dark = false }: { dark?: boolean }) {
    return <OfficialBookingAction dark={dark} appURL={TRAIN_BOOKING_APP_URL} webURL={TRAIN_BOOKING_URL} name="코레일" label="코레일 앱으로 예매"
        note="앱을 열 수 없으면 공식 웹으로 연결해요. 역·날짜는 예매처에서 선택해 주세요. 예매 후 승차권 이미지·PDF·텍스트를 NoLate에 공유하면 가져올 수 있어요." />;
}
