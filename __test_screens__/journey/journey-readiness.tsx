import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAutomaticJourneySnapshot } from '../../src/modules/journey/automaticJourney';
import { getAutomaticJourneySyncState } from '../../src/modules/journey/automaticJourneyTrial';
import { getJourneyDiagnostics } from '../../src/modules/journey/journeyDiagnostics';
import { journeyReadinessReport, type ReadinessCheck } from '../../src/modules/journey/journeyReadiness';

export default function JourneyReadinessRoute() {
    if (!__DEV__ || Platform.OS !== 'ios') return <Redirect href="/schedule" />;
    return <ReadinessScreen />;
}
function ReadinessScreen() {
    const router = useRouter(); const insets = useSafeAreaInsets();
    const [checks, setChecks] = useState<ReadinessCheck[]>([]);
    const [pending, setPending] = useState(false); const [failed, setFailed] = useState(false);
    const refresh = async () => {
        if (pending) return;
        setPending(true); setFailed(false);
        try {
            const [native, probe] = await Promise.all([getAutomaticJourneySnapshot(), getJourneyDiagnostics()]);
            setChecks(journeyReadinessReport(native, getAutomaticJourneySyncState(), probe, Date.now() / 1000));
        } catch { setChecks([]); setFailed(true); }
        finally { setPending(false); }
    };
    return <ScrollView style={{ backgroundColor: 'white' }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}>
        <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '700', color: '#172B4D' }}>길안내 검증 상태</Text>
        <Text style={{ marginVertical: 16 }}>읽기 전용 · 위치 추적/음성/푸시를 시작하지 않습니다. 좌표·토큰·계정 식별자는 표시하지 않습니다. 구현 범위와 이 세션의 관측은 별개이며, 합성 시험·미검증은 실제 내비게이션 성공이 아닙니다.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="진단 상태 새로고침" accessibilityState={{ disabled: pending }} disabled={pending} onPress={refresh}
            style={{ backgroundColor: '#1264C7', padding: 16, borderRadius: 12 }}><Text style={{ color: 'white', fontWeight: '700' }}>진단 상태 새로고침</Text></Pressable>
        {failed && <Text testID="journey-readiness-error">진단 조회 실패 · 다시 시도하세요</Text>}
        {checks.map(check => <Text testID={`journey-readiness-${check.code}`} key={check.code} style={{ color: '#172B4D', marginVertical: 12, fontSize: 17 }}>
            {check.code} · {check.state}{'\n'}{check.detail}</Text>)}
        <Pressable accessibilityRole="button" accessibilityLabel="길안내 시험 화면으로 돌아가기" onPress={() => router.back()} style={{ paddingVertical: 20 }}>
            <Text style={{ color: '#1264C7' }}>길안내 시험 화면으로 돌아가기</Text></Pressable>
    </ScrollView>;
}
