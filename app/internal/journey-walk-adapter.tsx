import React, { useState } from 'react';
import { Redirect } from 'expo-router';
import { Pressable, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseTmapPedestrianGeometry } from '../../src/modules/map/tmapPedestrianGeometry';
import { pedestrianGeometryFixture } from '../../src/modules/journey/pedestrianGeometryFixtures';
import { JourneyServerWalkingTrial } from '../../src/modules/journey/JourneyServerWalkingTrial';
import { JourneyWalkingSnapshotTrial } from '../../src/modules/journey/JourneyWalkingSnapshotTrial';

const examples = [ ['complete', '연결된 원본'], ['gap', '끊어진 원본'], ['invalid', '잘못된 좌표'],
    ['endpoint', '다른 도착지'] ] as const;
export default function JourneyWalkAdapterRoute() {
    if (!__DEV__) return <Redirect href="/schedule" />;
    return <WalkAdapterScreen />;
}
function WalkAdapterScreen() {
    const [server, setServer] = useState(false);
    const [stored, setStored] = useState(false);
    const insets = useSafeAreaInsets();
    const [selected, setSelected] = useState<typeof examples[number][0]>('complete');
    const fixture = pedestrianGeometryFixture(selected);
    const result = parseTmapPedestrianGeometry(fixture.data, fixture.origin, fixture.destination);
    return <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24, gap: 20 }} style={{ backgroundColor: 'white' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={stored ? '원본 형상 검사로 전환' : '서버 저장 검사로 전환'}
            onPress={() => {setStored(value=>!value);setServer(false);}} style={{padding:12,borderRadius:12,backgroundColor:'#EDF3FB'}}>
            <Text style={{color:'#1264C7',fontWeight:'600'}}>{stored ? '원본 형상 검사로 전환' : '서버 저장 검사로 전환'}</Text>
        </Pressable>
        {!stored && <Pressable accessibilityRole="button" accessibilityLabel={server ? '원본 형상 검사로 전환' : '서버 계약 검사로 전환'}
            onPress={() => setServer(value => !value)} style={{ padding: 12, borderRadius: 12, backgroundColor: '#EDF3FB' }}>
            <Text style={{ color: '#1264C7', fontWeight: '600' }}>{server ? '원본 형상 검사로 전환' : '서버 계약 검사로 전환'}</Text>
        </Pressable>}
        {stored ? <JourneyWalkingSnapshotTrial /> : server ? <JourneyServerWalkingTrial /> : <>
        <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '700' }}>도보 원본 형상 검사</Text>
        <Text>R4-4 개발 전용 · 합성 응답 · 실제 공급자 조회 아님</Text>
        <Text>API 요청·위치 추적·저장 경로 변경 없음. 검사 통과는 자동 길안내 허용이 아닙니다.</Text>
        {examples.map(([id, label]) => <Pressable key={id} testID={`walk-adapter-${id}`}
            accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: id === selected }}
            onPress={() => setSelected(id)} style={{ padding: 16, borderRadius: 12,
                backgroundColor: id === selected ? '#1264C7' : '#EEF2F6' }}>
            <Text style={{ color: id === selected ? 'white' : '#152536', fontWeight: '600' }}>{label}</Text>
        </Pressable>)}
        <Text testID="walk-adapter-result" accessibilityLiveRegion="polite" style={{ fontSize: 20, fontWeight: '700' }}>
            {result.ok ? '원본 연결 검사 통과' : `원본 연결 차단 · ${result.reason}`}</Text>
        {result.ok && <Text testID="walk-adapter-counts">원본 {result.rawLinePointCount}점 · 전달 {result.coordinates.length}점 · {result.lineCount}개 선형</Text>}
        <Text>출처: TMAP pedestrian 전용 · ODsay 경로에 덮어쓰기 금지</Text>
        <Text testID="walk-adapter-guidance">자동 길안내 OFF · 서버 공급자 재검증 필요</Text>
        </>}
    </ScrollView>;
}
