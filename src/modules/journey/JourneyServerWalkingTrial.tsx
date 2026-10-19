import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { loadWalkingContractTrial, walkingContractCases, type WalkingContractCase, type WalkingContractSummary } from './serverWalkingContractTrial';

const labels = ['서버 도보 연결', '다른 소유자 차단', 'revision 변경 차단', '저장 경로 변경 차단',
    '도보 유효시간 만료', '끊어진 서버 형상', '공급자 출처 위장 차단', 'HTTP 도보 연결', '조회 중 경로 변경',
    '조회 중 로그인 철회', 'HTTP 리다이렉트 차단', 'HTTP 본문 크기 초과', 'HTTP 본문 응답 지연'];
export function JourneyServerWalkingTrial() {
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<WalkingContractSummary | null>(null);
    const [error, setError] = useState(false);
    const [http, setHttp] = useState(false);
    const active = useRef(true); const inFlight = useRef(false);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    if (!__DEV__) return null;
    const run = async (selected: WalkingContractCase) => {
        if (inFlight.current) return;
        inFlight.current = true; setPending(true); setResult(null); setError(false);
        try { const value = await loadWalkingContractTrial(selected); if (active.current) setResult(value); }
        catch { if (active.current) setError(true); }
        finally { inFlight.current = false; if (active.current) setPending(false); }
    };
    return <View style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={http ? '기본 계약 검사로 전환' : 'HTTP 서버 연결 검사로 전환'}
            accessibilityState={{ disabled: pending }} disabled={pending}
            onPress={() => { if (!inFlight.current) { setHttp(value => !value); setResult(null); setError(false); } }}
            style={{ padding: 12, borderRadius: 12, backgroundColor: '#EDF3FB' }}>
            <Text style={{ color: '#1264C7', fontWeight: '600' }}>{http ? '기본 계약 검사로 전환' : 'HTTP 서버 연결 검사로 전환'}</Text>
        </Pressable>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700' }}>서버 소유 도보 계약</Text>
        <Text>{http ? '로컬 HTTP 합성 공급자·시험 JWT. 실제 HTTPS/API 키 전송 없음. DB 동시 변경은 별도 자동 검사.'
            : '별도 합성 서버·시험 JWT. ODsay 경로와 TMAP 도보 출처를 분리합니다. 실제 조회·경로 변경·GPS 실행 없음.'}</Text>
        {walkingContractCases.map((id, i) => id.startsWith('http-') !== http ? null : <Pressable key={id} accessibilityRole="button"
            accessibilityLabel={labels[i]} accessibilityState={{ disabled: pending }} disabled={pending}
            testID={`walking-contract-${id}`} onPress={() => { void run(id); }}
            style={{ padding: 16, borderRadius: 12, backgroundColor: pending ? '#E1E5EA' : '#EDF3FB' }}>
            <Text style={{ color: '#152536', fontWeight: '600' }}>{labels[i]}</Text>
        </Pressable>)}
        <Text testID="walking-contract-result" accessibilityLiveRegion="polite" style={{ fontSize: 18, fontWeight: '700' }}>
            {pending ? '서버 검사 중' : error ? '서버 검사 불가 · 안내 차단' : result
                ? `${result.status === 'BOUND' ? '도보 계약 통과' : '도보 계약 차단'} · ${result.reason}` : '아직 검사하지 않음'}</Text>
        {result && <Text testID="walking-contract-counts">도보 {result.walkCount}개 · 형상 {result.pointCount}점 · 합성 provider {result.providerCalls}회</Text>}
        {result?.authorityReads != null && <Text>서버 재검증 {result.authorityReads}회 · redirect trap 0회</Text>}
        <Text>자동 길안내 OFF · 실제 버스·저장 원본·native 혼합 계약 연결은 후속 단계</Text>
    </View>;
}
