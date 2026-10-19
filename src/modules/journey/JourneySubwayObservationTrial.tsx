import React, {useEffect, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {loadSubwayObservationDiagnostic, subwayDiagnosticCases, type SubwayDiagnosticCase, type SubwayObservationDiagnostic} from './subwayObservationDiagnostic';

export function JourneySubwayObservationTrial() {
    const revision = useRef(0), busy = useRef(false);
    const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
    const [result, setResult] = useState<SubwayObservationDiagnostic | null>(null);
    useEffect(() => () => { ++revision.current; }, []);
    async function run(selected: SubwayDiagnosticCase) {
        if (busy.current) return;
        busy.current = true; const request = ++revision.current;
        setPending(true); setFailed(false); setResult(null);
        try {
            const value = await loadSubwayObservationDiagnostic(selected);
            if (revision.current === request) setResult(value);
        } catch { if (revision.current === request) setFailed(true); }
        finally { if (revision.current === request) { busy.current = false; setPending(false); } }
    }
    return <View style={{gap: 10}}>
        <Text accessibilityRole="header" style={{fontSize: 24, fontWeight: '700', color: '#152536'}}>지하철 관측 연결 시험</Text>
        <Text style={{color: '#152536'}}>합성 독립 역 대응·분기/급행 정차 순서·열차·저장 경로 / 로컬 HTTP 서버입니다. 실제 API·GPS·APNs를 사용하지 않습니다.</Text>
        <Text style={{color: '#152536'}}>열차 관측은 내 위치나 탑승 확정이 아닙니다. 자동 길안내는 계속 OFF입니다.</Text>
        <View testID="subway-diagnostic-result" accessibilityLiveRegion="polite" style={{padding: 16, borderRadius: 12, backgroundColor: '#EEF3F9', gap: 8}}>
            <Text style={{fontSize: 18, fontWeight: '700', color: '#152536'}}>{pending ? '검사 중 · 이전 결과 제거됨' : failed ? '서버 연결 실패 · 이전 결과 사용 안 함' : result ? `열차 관측 ${result.matchingTrainCount}개 · 탑승 미확정` : '검사 대기 · 내 위치 없음'}</Text>
            {result && <><Text style={{color: '#152536'}}>{result.case} · {result.status}</Text>
                <Text style={{color: '#152536'}}>로컬 공급자 {result.providerCalls}회 · 소유권 재검사 {result.authorityReads}회</Text></>}
            <Text style={{color: '#152536'}}>실제 공급자 0회 · GPS 미사용 · 위치 마커/남은 역 수 표시 안 함</Text>
        </View>
        {subwayDiagnosticCases.map(([key, label]) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
            accessibilityState={{disabled: pending}} disabled={pending} onPress={() => void run(key)}
            style={{padding: 14, borderRadius: 12, backgroundColor: pending ? '#E2E7EE' : '#1264C7'}}>
            <Text style={{color: pending ? '#526174' : 'white', fontWeight: '600'}}>{label}</Text>
        </Pressable>)}
    </View>;
}
