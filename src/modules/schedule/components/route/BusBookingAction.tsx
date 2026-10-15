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
            name="티머니GO" label="티머니GO 앱으로 예매"
            note="앱을 열 수 없으면 공식 버스 예매 웹으로 연결해요. 터미널·날짜는 예매처에서 선택하세요. 표 이미지·PDF·텍스트를 NoLate에 공유할 수 있어요." />
        {kind !== 'EXPRESS_BUS' && <>
            <Text style={[styles.note, { color: dark ? '#B1B8C4' : '#536176' }]}>노선에 따라 예매처가 달라요. 티머니에 없으면 버스타고에서 확인하세요.</Text>
            <OfficialBookingAction dark={dark} webURL={BUSTAGO_BOOKING_URL} name="버스타고" label="버스타고 공식 예매"
                note="버스타고 공식 웹에서 해당 노선의 예매 가능 여부를 확인해 주세요." />
        </>}
    </View>;
}

const styles = StyleSheet.create({ container: { gap: 8 }, note: { fontSize: 12 } });
