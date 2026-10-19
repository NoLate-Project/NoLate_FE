import React, {useEffect, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {loadWalkingSnapshotTrial, walkingSnapshotTrialCases, type WalkingSnapshotTrialSummary, type WalkingSnapshotTrialCase} from './serverWalkingSnapshot';
const labels = ['서버에 도보 경로 저장','저장 경로 다시 읽기','교체 후 이전 취소 차단','저장 경로 취소','저장 후 경로 변경','저장 후 로그인 철회','저장 유효시간 만료'];
export function JourneyWalkingSnapshotTrial() {
    const [pending,setPending] = useState(false); const [result,setResult] = useState<WalkingSnapshotTrialSummary|null>(null);
    const [error,setError] = useState(false); const active = useRef(true); const busy = useRef(false);
    useEffect(()=>{active.current=true; return ()=>{active.current=false;};},[]);
    if (!__DEV__) return null;
    const run = async (id: WalkingSnapshotTrialCase) => {
        if (busy.current) return; busy.current=true; setPending(true); setResult(null); setError(false);
        try {const value=await loadWalkingSnapshotTrial(id); if(active.current) setResult(value);}
        catch {if(active.current) setError(true);}
        finally {busy.current=false; if(active.current) setPending(false);}
    };
    return <View style={{gap:12}}>
        <Text accessibilityRole="header" style={{fontSize:22,fontWeight:'700'}}>서버 도보 저장 계약</Text>
        <Text>독립 H2 파일·실제 저장 API. 합성 경로/로그인·로컬 HTTP 공급자. 실제 API·GPS·APNs 실행 없음.</Text>
        {walkingSnapshotTrialCases.map((id,i)=><Pressable key={id} testID={`walking-snapshot-${id}`} accessibilityRole="button"
            accessibilityLabel={labels[i]} accessibilityState={{disabled:pending}} disabled={pending} onPress={()=>{void run(id);}}
            style={{padding:16,borderRadius:12,backgroundColor:'#EDF3FB'}}><Text style={{color:'#152536',fontWeight:'600'}}>{labels[i]}</Text></Pressable>)}
        <Text testID="walking-snapshot-result" accessibilityLiveRegion="polite" style={{fontSize:18,fontWeight:'700'}}>
            {pending ? '서버 저장 검사 중' : error ? '서버 저장 검사 불가 · 안내 차단' : result
                ? `${result.status==='STORED' ? '저장 경로 수신' : '저장 경로 차단'} · ${result.reason}` : '아직 검사하지 않음'}</Text>
        {result && <Text testID="walking-snapshot-counts">도보 {result.walkCount}개 · 형상 {result.pointCount}점</Text>}
        <Text>재조회는 TTL 연장·공급자 재조회 없음. 자동 길안내 OFF · native 혼합 경로 연결 전.</Text>
    </View>;
}
