import React, { useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { configureAutomaticJourneyNoticeMode } from './automaticJourney';
import { requestPushNotificationPermission } from '../notification/pushPermission';
import { journeyNoticeAvailability } from './journeyNoticeAvailability';

/** Debug screen owns explicit actions only. Rendering never requests permission or registers tokens. */
export function JourneyNoticeControls({ running, pending, refresh, compact = false, selectedMode, permission, onPendingChange }: {
    running: boolean; pending: boolean; refresh: () => Promise<void>;
    compact?: boolean; selectedMode?: string; permission?: string; onPendingChange?: (pending: boolean) => void;
}) {
    const busy = useRef(false);
    const [working, setWorking] = useState(false);
    const [result, setResult] = useState('NOT_REQUESTED');
    const [expanded, setExpanded] = useState(!compact);
    const [chosen, setChosen] = useState<string>();
    const selected = selectedMode ?? chosen;
    const label = selected === 'NOTIFICATIONS' ? '알림 안내' : selected === 'VOICE_AND_NOTIFICATIONS' ? '음성 + 알림' : '꺼짐';
    // A just-granted OS result can precede the native settings snapshot. Do not
    // keep claiming denial, or infer lock-screen availability from a Boolean.
    const effectivePermission = result === 'PERMISSION_GRANTED' && permission?.startsWith('NOT_DETERMINED_') ? undefined : permission;
    const availability = journeyNoticeAvailability(selected, effectivePermission);
    if (running) return null;
    const disabled = pending || working;
    const act = async (action: () => Promise<void>) => {
        if (busy.current || pending) return;
        busy.current = true; setWorking(true); onPendingChange?.(true);
        try { await action(); }
        catch { setResult('NOTICE_ACTION_UNAVAILABLE'); }
        finally { busy.current = false; setWorking(false); onPendingChange?.(false); }
    };
    const button = (id: string, label: string, action: () => Promise<void>, selectedValue?: string) => <Pressable
        testID={`saved-guidance-${id}`} accessibilityRole="button" accessibilityLabel={label}
        disabled={disabled} accessibilityState={{ disabled, ...(selectedValue ? { selected: selected === selectedValue } : {}) }} onPress={() => void act(action)}
        style={{ padding: 14, backgroundColor: disabled ? '#A8B8CC' : selectedValue && selected !== selectedValue ? '#45556B' : '#1264C7', borderRadius: 10, marginVertical: 4 }}>
        <Text style={{ color: 'white', fontWeight: '600' }}>{label}</Text>
    </Pressable>;
    const mode = async (value: 'OFF' | 'NOTIFICATIONS' | 'VOICE_AND_NOTIFICATIONS') => {
        await configureAutomaticJourneyNoticeMode(value); setChosen(value); await refresh(); setResult('CHANNEL_SELECTED');
    };
    return <View>
        {compact && <Pressable testID="saved-guidance-notice-expand" accessibilityRole="button"
            accessibilityLabel={`음성·알림 설정, ${label}`} accessibilityState={{ expanded, disabled }} disabled={disabled}
            onPress={() => { if (!disabled) setExpanded(value => !value); }}
            style={{ minHeight: 48, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: '#1264C7', fontWeight: '600' }}>음성·알림 설정</Text><Text>{label} {expanded ? '⌃' : '⌄'}</Text>
        </Pressable>}
        {availability && <Text testID="saved-guidance-notice-availability" accessibilityLiveRegion="polite">{availability}</Text>}
        {expanded && <View testID="saved-guidance-notice-options">
        <Text>알림 권한은 아래 요청 버튼을 누를 때만 요청해요. 전경 음성은 무음을 존중하며 잠금 상태에는 알림을 사용해요. 접수/큐 수는 실제 표시·청취 증명이 아닙니다.</Text>
        <Text testID="saved-guidance-notice-permission-result">알림 설정 결과: {result}</Text>
        {button('notice-permission', '시험 안내 알림 권한 요청', async () => {
            setResult(await requestPushNotificationPermission() ? 'PERMISSION_GRANTED' : 'PERMISSION_NOT_GRANTED');
        })}
        {button('notice-settings', '이 시험 앱의 시스템 설정 열기', async () => { await Linking.openSettings(); })}
        {button('notice-notifications', '알림 안내 선택', () => mode('NOTIFICATIONS'), 'NOTIFICATIONS')}
        {button('notice-voice', '전경 음성 + 알림 안내 선택', () => mode('VOICE_AND_NOTIFICATIONS'), 'VOICE_AND_NOTIFICATIONS')}
        {button('notice-off', '안내 알림·음성 끄기', () => mode('OFF'), 'OFF')}
        </View>}
    </View>;
}
