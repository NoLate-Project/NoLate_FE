import { Ionicons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { isAutomaticJourneyEntryEnabled, isJourneyGuidanceEnabled } from './journeyFeature';

/** Compatibility deep link only. The owned route detail supplies GPS preparation and
 * revalidation. Merely opening this link never creates or advances a manual session. */
export default function JourneyGuidanceScreen() {
    const params = useLocalSearchParams<{ scheduleId?: string | string[] }>();
    const value = params.scheduleId;
    const scheduleId = Array.isArray(value) ? value.length === 1 ? value[0] : undefined : value;
    const valid = typeof scheduleId === 'string' && /^[1-9]\d{0,15}$/.test(scheduleId)
        && Number.isSafeInteger(Number(scheduleId));
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    if (valid && isJourneyGuidanceEnabled() && isAutomaticJourneyEntryEnabled()) {
        return <Redirect href={{ pathname: '/schedule/[id]', params: { id: scheduleId, openRouteDetail: '1' } }} />;
    }
    return <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="이전 화면으로 돌아가기" style={styles.back}
            onPress={() => router.canGoBack() ? router.back() : router.replace('/schedule')}>
            <Ionicons name="chevron-back" size={25} color={colors.textPrimary} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>대중교통 길안내</Text>
        <Text testID="journey-entry-unavailable" style={[styles.message, { color: colors.textSecondary }]}>{valid
            ? '이 빌드에서는 위치 기반 길안내를 아직 사용할 수 없어요. 탑승·하차를 버튼으로 진행하지 않습니다.'
            : '일정에서 길안내를 다시 열어 주세요.'}</Text>
    </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, paddingHorizontal: 20 },
    back: { width: 44, height: 44, justifyContent: 'center' },
    title: { fontSize: 23, fontWeight: '700', marginVertical: 20 },
    message: { fontSize: 15, lineHeight: 24 } });
