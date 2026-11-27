import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSystemReduceMotion } from '../performance/useSystemReduceMotion';
import { requestPushNotificationPermission } from '../notification/pushPermission';
import { configureAutomaticJourneyNoticeMode, getAutomaticJourneySnapshot } from './automaticJourney';

const channels = [
    { mode: 'VOICE_AND_NOTIFICATIONS', name: '음성 및 알림', icon: 'volume-high-outline' },
    { mode: 'NOTIFICATIONS', name: '알림만', icon: 'notifications-outline' },
    { mode: 'OFF', name: '끄기', icon: 'notifications-off-outline' },
] as const;

type Props = {
    dark: boolean;
    onClose: () => void;
    sessionId?: string;
    onStop?: () => Promise<void>;
    onPrepare?: () => void;
    onChangeRoute?: () => void;
};

/** Mounted on explicit menu entry. Reading the saved choice never requests permission. */
export function JourneyNavigationOptions({ dark, onClose, sessionId, onStop, onPrepare, onChangeRoute }: Props) {
    const { bottom } = useSafeAreaInsets();
    const reduceMotion = useSystemReduceMotion();
    const [mode, setMode] = useState<string>();
    const [permission, setPermission] = useState<string>();
    const [feedback, setFeedback] = useState('');
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        let active = true;
        getAutomaticJourneySnapshot().then(snapshot => {
            if (!active) return;
            setMode(snapshot.guidanceNoticeMode);
            if (!snapshot.guidanceNoticeMode) setFeedback('안내 방식을 불러오지 못했어요.');
            setPermission(snapshot.guidanceNoticePermission);
        }).catch(() => { if (active) setFeedback('안내 방식을 불러오지 못했어요.'); });
        return () => { active = false; mounted.current = false; };
    }, []);
    const act = async (work: () => Promise<void>) => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setFeedback('');
        try { await work(); }
        catch { if (mounted.current) setFeedback('변경을 적용하지 못했어요. 다시 시도해 주세요.'); }
        finally { lock.current = false; if (mounted.current) setBusy(false); }
    };
    const close = () => { if (!lock.current) onClose(); };
    const ink = dark ? '#F5F7FA' : '#172232';
    const muted = dark ? '#ACB9CB' : '#536176';
    const accent = dark ? '#8BB9FF' : '#175AC0';
    const border = dark ? '#343D49' : '#DFE5EC';
    const denied = permission?.startsWith('DENIED_') || permission?.includes('_LOCK_OFF');
    const authorized = permission?.includes('_LOCK_ON') || permission === 'GRANTED';
    return <Modal visible transparent presentationStyle="overFullScreen" animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
        <View style={styles.overlay}>
            <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={close}/>
            <View accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.sheet, {
                backgroundColor: dark ? '#1A1F27' : '#FFFFFF', paddingBottom: Math.max(bottom, 16),
            }]}>
                <View style={styles.header}>
                    <Text accessibilityRole="header" style={[styles.title, {color: ink}]}>길안내 옵션</Text>
                    <Pressable testID="journey-options-close" accessibilityRole="button" accessibilityLabel="길안내 옵션 닫기"
                        onPress={close} disabled={busy} style={styles.iconButton}>
                        <Ionicons name="close-outline" size={24} color={muted}/>
                    </Pressable>
                </View>
                <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                    <Text style={[styles.section, {color: muted}]}>안내 방식</Text>
                    {channels.map(channel => {
                        const selected = mode === channel.mode;
                        return <Pressable key={channel.mode} testID={'journey-option-' + channel.mode}
                            accessibilityRole="radio" accessibilityState={{checked: selected, selected, disabled: busy || !mode}}
                            disabled={busy || !mode} onPress={() => { if (!selected) void act(async () => {
                                await configureAutomaticJourneyNoticeMode(channel.mode, sessionId);
                                if (mounted.current) setMode(channel.mode);
                            }); }}
                            style={({pressed}) => [styles.row, { backgroundColor: selected
                                ? dark ? '#24364F' : '#EAF2FF' : 'transparent', opacity: pressed ? 0.65 : 1 }]}>
                            <Ionicons name={channel.icon} color={selected ? accent : muted} size={22}/>
                            <Text style={[styles.rowText, {color: selected ? accent : ink}]}>{channel.name}</Text>
                            {selected && <Ionicons accessible={false} name="checkmark-outline" color={accent} size={22}/>}
                        </Pressable>;
                    })}
                    {mode && mode !== 'OFF' && !authorized && <Pressable testID="journey-option-permission" accessibilityRole="button"
                        disabled={busy} onPress={() => void act(async () => {
                            if (denied) { await Linking.openSettings(); return; }
                            const allowed = await requestPushNotificationPermission();
                            if (mounted.current) {
                                setPermission(allowed ? 'GRANTED' : 'DENIED_UNKNOWN');
                                setFeedback(allowed ? '길안내 알림을 허용했어요.' : 'iOS 설정에서 알림을 허용해 주세요.');
                            }
                        })} style={styles.row}>
                        <Text style={[styles.link, {color: accent}]}>{denied ? 'iOS 알림 설정 열기' : '길안내 알림 권한 확인'}</Text>
                        <Ionicons name="chevron-forward-outline" size={16} color={muted}/>
                    </Pressable>}
                    {!!feedback && <Text accessibilityLiveRegion="polite" style={{color: muted}}>{feedback}</Text>}
                    {(onStop || onPrepare || onChangeRoute) && <View style={[styles.bottom, {borderTopColor: border}]}>
                        {onStop ? <Pressable testID="saved-detail-stop" accessibilityRole="button" accessibilityLabel="길안내 종료"
                            disabled={busy} onPress={() => void act(onStop)}
                            style={({pressed}) => [styles.action, {backgroundColor: dark ? '#322528' : '#FFF1F0', opacity: pressed ? 0.7 : 1}]}>
                            <Ionicons name="stop-circle-outline" color={dark ? '#FFAAA6' : '#A42A24'} size={20}/>
                            <Text style={[styles.actionText, {color: dark ? '#FFAAA6' : '#A42A24'}]}>길안내 종료</Text>
                        </Pressable> : onChangeRoute ? <Pressable testID="journey-options-change-route" accessibilityRole="button"
                            accessibilityLabel="다른 경로 찾기" disabled={busy} onPress={onChangeRoute}
                            style={[styles.action, {backgroundColor: dark ? '#283442' : '#F1F4F8'}]}>
                            <Ionicons name="map-outline" color={muted} size={18}/>
                            <Text style={[styles.actionText, {color: ink}]}>다른 경로 찾기</Text>
                            <Ionicons name="chevron-forward-outline" color={muted} size={18}/>
                        </Pressable> : <Pressable testID="journey-options-prepare" accessibilityRole="button" onPress={onPrepare}
                            disabled={busy} style={[styles.action, {backgroundColor: dark ? '#283442' : '#F1F4F8'}]}>
                            <Text style={[styles.actionText, {color: ink}]}>출발 전 경로 설정</Text>
                            <Ionicons name="chevron-forward-outline" color={muted} size={18}/>
                        </Pressable>}
                    </View>}
                </ScrollView>
            </View>
        </View>
    </Modal>;
}

const styles = StyleSheet.create({
    overlay: {flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(9,16,26,0.38)'},
    sheet: {width: '100%', maxWidth: 600, maxHeight: '90%', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 12},
    header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 24, paddingRight: 12},
    title: {fontSize: 22, fontWeight: '700'}, iconButton: {minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center'},
    content: {paddingHorizontal: 16, paddingBottom: 6}, section: {fontSize: 13, fontWeight: '600', marginHorizontal: 10, marginTop: 10, marginBottom: 6},
    row: {minHeight: 50, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12},
    rowText: {flex: 1, fontSize: 17, fontWeight: '600'}, link: {flex: 1, fontSize: 15},
    bottom: {marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth},
    action: {minHeight: 50, padding: 10, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8},
    actionText: {fontSize: 16, fontWeight: '600'},
});
