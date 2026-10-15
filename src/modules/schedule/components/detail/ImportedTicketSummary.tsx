import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import { getImportedTicket } from '../../importedTicket';
import BusBookingAction from '../route/BusBookingAction';
import TrainBookingAction from '../route/TrainBookingAction';

export default function ImportedTicketSummary({ route, showBooking = true }: { route: unknown; showBooking?: boolean }) {
    const { colors, mode } = useTheme();
    const ticket = getImportedTicket(route);
    if (!ticket) return null;
    return <View testID="imported-ticket-summary" style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>가져온 {ticket.kind === 'TRAIN' ? '기차' : '버스'} 승차권</Text>
        <Text style={{ color: colors.textPrimary }}>{ticket.departureName} → {ticket.arrivalName} · {ticket.trainNumber ? `${ticket.trainNumber}편` : ticket.grade}</Text>
        <Text style={[styles.note, { color: colors.textSecondary }]}>{ticket.departureAt.slice(0, 10)} {ticket.departureAt.slice(11, 16)} → {ticket.arrivalAt.slice(0, 10) !== ticket.departureAt.slice(0, 10) ? `${ticket.arrivalAt.slice(5, 10)} ` : ''}{ticket.arrivalAt.slice(11, 16)} · 사용자 확인 · 예매 상태 미검증</Text>
        {!(route as { intercityJourney?: unknown }).intercityJourney && <Text style={[styles.note, { color: colors.textSecondary }]}>최종 도착지와 도착 희망 시각은 일정 수정에서 설정하세요. 승차권 시각은 유지됩니다.</Text>}
        {showBooking && <Text style={[styles.note, { color: colors.textSecondary }]}>표를 변경·취소했다면 이 일정도 삭제하고, 유효한 새 표를 다시 공유해 주세요. 예매처의 변경·취소 상태는 자동 동기화되지 않아요.</Text>}
        {showBooking && (ticket.kind === 'TRAIN' ? <TrainBookingAction dark={mode === 'dark'} /> : <BusBookingAction kind={ticket.kind} dark={mode === 'dark'} />)}
    </View>;
}
const styles = StyleSheet.create({ card: { padding: 16, borderWidth: 1, borderRadius: 16, gap: 6 }, title: { fontSize: 16, fontWeight: '600' }, note: { fontSize: 13, lineHeight: 20 } });
