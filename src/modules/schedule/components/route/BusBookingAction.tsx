import React from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { OfficialBookingAction } from './TrainBookingAction';

// Official txbus mobile guide → download link → iOS bridge observed 2026-10-13.
// Main screen only; omit tracking identifiers and all trip/account/ticket parameters.
export const BUS_BOOKING_APP_URL = 'tmoneytia://main/home';
export const INTERCITY_BUS_BOOKING_URL = 'https://intercitybus.tmoney.co.kr/';
export const EXPRESS_BUS_BOOKING_URL = 'https://www.kobus.co.kr/';
export const BUSTAGO_BOOKING_URL = 'https://www.bustago.or.kr/';

export default function BusBookingAction({ kind, dark = false }: { kind: string; dark?: boolean }) {
    if (Platform.OS !== 'ios') return null;
    if (!['EXPRESS_BUS', 'INTERCITY_BUS', 'COACH'].includes(kind)) return null;
    return <View style={styles.container}>
        <OfficialBookingAction dark={dark} appURL={BUS_BOOKING_APP_URL}
            webURL={kind === 'EXPRESS_BUS' ? EXPRESS_BUS_BOOKING_URL : INTERCITY_BUS_BOOKING_URL}
            name="티머니GO" label="티머니GO에서 예매" />
        {kind !== 'EXPRESS_BUS' && (
            <OfficialBookingAction dark={dark} webURL={BUSTAGO_BOOKING_URL} name="버스타고" label="버스타고에서 예매" />
        )}
        <Text style={[styles.note, { color: dark ? '#B1B8C4' : '#536176' }]}>터미널과 날짜는 예매처에서 선택해 주세요.</Text>
    </View>;
}

const styles = StyleSheet.create({ container: { gap: 8 }, note: { fontSize: 12 } });
