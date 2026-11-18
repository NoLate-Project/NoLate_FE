import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, LinearTransition, ReduceMotion, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getBlockedSharingMembers,
  unblockSharingMember,
  type BlockedSharingMember,
} from '../../src/api/sharingSafety';
import { recoverDepartureAlarmsAfterMutation } from '../../src/modules/notification/departureAlarmMutationRecovery';
import { useSystemReduceMotion } from '../../src/modules/performance/useSystemReduceMotion';
import { useTheme } from '../../src/modules/theme/ThemeContext';
import { useScreenFirstPaintPerformance } from '../../src/modules/performance/useScreenFirstPaintPerformance';
import { useImmediateNavigationTransition } from '../../src/modules/performance/ImmediateNavigationTransition';
import { usePreMountedSceneActivity } from '../../src/modules/performance/preMountedSceneActivity';
import { SharingRefreshRetryBanner } from '../../src/routeSupport/share/SharingRefreshRetryBanner';
import { BrandedLoadingState } from '../../src/ui/BrandedLoader';

const rowChange = LinearTransition.duration(180).reduceMotion(ReduceMotion.System);
const confirmationIn = SlideInDown.duration(200).reduceMotion(ReduceMotion.System);
const backdropIn = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const unblockNotice = '차단을 해제했어요.';

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '차단 목록을 불러오지 못했습니다.';
  if (/network|timeout/i.test(message)) return '네트워크 상태를 확인해 주세요.';
  return message;
}

function blockedMemberLabel(member: BlockedSharingMember) {
  return member.name?.trim() || member.email?.trim() || `회원 #${member.memberId}`;
}

export default function BlockedSharingMembersScreen() {
  useScreenFirstPaintPerformance('/share/blocked');
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { closeActiveScene } = useImmediateNavigationTransition();
  const sceneActive = usePreMountedSceneActivity();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useSystemReduceMotion();
  const largeText = fontScale > 1.35;
  const accent = mode === 'dark' ? '#9FC5FF' : '#205CC6';
  const actionInk = mode === 'dark' ? '#102344' : '#FFFFFF';
  const mountedRef = useRef(true);
  const requestId = useRef(0);
  const loaded = useRef(false);
  const applying = useRef(false);
  const focusTarget = useRef<number | null>(null);
  const showNoticeOnDismiss = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowButtons = useRef(new Map<number, React.ElementRef<typeof Pressable>>());
  const backButton = useRef<React.ElementRef<typeof Pressable>>(null);
  const confirmationHeading = useRef<React.ElementRef<typeof Text>>(null);
  const [members, setMembers] = useState<BlockedSharingMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [confirmation, setConfirmation] = useState<BlockedSharingMember | null>(null);
  const [pending, setPending] = useState(false);
  const [unblockFailure, setUnblockFailure] = useState<string | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (closeActiveScene()) return;
    if (router.canGoBack()) router.back();
    else router.replace(from === 'safety' ? '/share/safety' : '/share/inbox');
  }, [closeActiveScene, from, router]);

  const load = useCallback(async (source: 'initial' | 'resume' | 'pull' | 'retry' = 'initial') => {
    if (applying.current) return;
    const request = ++requestId.current;
    if (source === 'initial') {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
      setPullRefreshing(source === 'pull');
    }
    try {
      const next = await getBlockedSharingMembers();
      if (mountedRef.current && request === requestId.current) {
        setMembers(next);
        setError(null);
        loaded.current = true;
      }
    } catch (loadError) {
      if (mountedRef.current && request === requestId.current) setError(errorMessage(loadError));
    } finally {
      if (mountedRef.current && request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
        setPullRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestId.current += 1;
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (sceneActive !== false) {
      void load(loaded.current ? 'resume' : 'initial');
    } else {
      showNoticeOnDismiss.current = false;
      setNoticeVisible(false);
    }
  }, [load, sceneActive]);

  const restoreFocus = useCallback(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === null) return;
    const shouldShowNotice = showNoticeOnDismiss.current;
    showNoticeOnDismiss.current = false;
    requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      const element = rowButtons.current.get(target) ?? backButton.current;
      if (element) AccessibilityInfo.sendAccessibilityEvent?.(element, 'focus');
      if (shouldShowNotice) {
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
        setNoticeVisible(true);
        if (Platform.OS === 'ios') {
          AccessibilityInfo.announceForAccessibilityWithOptions?.(unblockNotice, { queue: true });
        }
        noticeTimer.current = setTimeout(() => {
          noticeTimer.current = null;
          setNoticeVisible(false);
        }, 2200);
      }
    });
  }, []);

  const dismissConfirmation = () => {
    if (applying.current || !confirmation) return;
    focusTarget.current = confirmation.memberId;
    setConfirmation(null);
    if (Platform.OS !== 'ios') restoreFocus();
  };

  const applyUnblock = async () => {
    if (!confirmation || applying.current) return;
    const memberId = confirmation.memberId;
    applying.current = true;
    requestId.current += 1;
    setRefreshing(false);
    setPullRefreshing(false);
    setPending(true);
    setUnblockFailure(null);
    try {
      await unblockSharingMember(memberId);
      if (!mountedRef.current) return;
      const index = members.findIndex(member => member.memberId === memberId);
      focusTarget.current = members[index + 1]?.memberId ?? members[index - 1]?.memberId ?? memberId;
      showNoticeOnDismiss.current = !largeText;
      setMembers(current => current.filter(member => member.memberId !== memberId));
      setConfirmation(null);
      if (Platform.OS !== 'ios') restoreFocus();
      void recoverDepartureAlarmsAfterMutation().catch(() => undefined);
    } catch (unblockError) {
      if (mountedRef.current) {
        setUnblockFailure(largeText ? errorMessage(unblockError) : '차단을 해제하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      applying.current = false;
      if (mountedRef.current) setPending(false);
    }
  };

  const showRefreshError = !largeText && !loading && members.length > 0 && error !== null;
  const noticeBottom = Math.max(18, insets.bottom) + 12;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={[styles.header, !largeText && [styles.sectionRule, { borderColor: colors.border }]]}>
        <Pressable
          ref={backButton}
          accessibilityRole="button"
          accessibilityLabel={from === 'safety' ? '공유 안전 관리로 돌아가기' : '공유함으로 돌아가기'}
          onPress={goBack}
          style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="chevron-back-outline" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>차단한 사용자</Text>
        {!loading && (!error || members.length > 0) ? (
          <Text accessibilityLabel={`차단한 사용자 ${members.length}명`}
            style={[styles.count, { backgroundColor: colors.surface2, color: colors.textSecondary }]}>
            {members.length}명
          </Text>
        ) : <View style={styles.headerSpacer} />}
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={pullRefreshing} onRefresh={() => { if (!confirmation && !refreshing) void load('pull'); }} />
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: showRefreshError ? noticeBottom + 66 : Math.max(insets.bottom, 20) + 20 },
        ]}
      >
        <Text lineBreakStrategyIOS="hangul-word" style={[styles.description, { color: colors.textSecondary }]}>
          차단한 사용자의 공유는 숨겨지고, 새 공유도 받지 않아요.
        </Text>

        {loading ? (
          <BrandedLoadingState style={styles.state} accessibilityLabel="차단 목록을 확인하고 있어요"
            title="차단 목록을 확인하고 있어요" />
        ) : error && members.length === 0 ? (
          <View accessibilityRole="alert" style={styles.state}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.textSecondary} />
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => load()} style={styles.retryButton}>
              <Text style={[styles.retryText, { color: colors.textPrimary }]}>다시 시도</Text>
            </Pressable>
          </View>
        ) : members.length === 0 ? (
          <View style={[
            styles.state,
            !largeText && [styles.emptyState, styles.sectionTopRule, { borderColor: colors.border }],
          ]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surface2 }]}>
              <Ionicons accessible={false} name="shield-checkmark-outline" size={25} color={accent} />
            </View>
            <Text style={[styles.stateText, !largeText && styles.emptyTitle, { color: colors.textPrimary }]}>
              차단한 사용자가 없어요
            </Text>
          </View>
        ) : (
          <View style={[styles.list, !largeText && [styles.sectionTopRule, { borderColor: colors.border }]]}>
            {members.map((member, index) => (
              <Animated.View
                key={member.memberId}
                layout={rowChange}
                style={[
                  styles.row,
                  largeText
                    ? [styles.rowLarge, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]
                    : [styles.rowStandard, styles.sectionRule, { borderColor: colors.border }],
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: colors.surface2 }]}>
                  <Ionicons name="person-outline" size={19} color={colors.textSecondary} />
                </View>
                <View style={styles.copy}>
                  <Text lineBreakStrategyIOS="hangul-word" style={[styles.memberName, { color: colors.textPrimary }]}>
                    {blockedMemberLabel(member)}
                  </Text>
                  {member.email && member.name ? (
                    <Text lineBreakStrategyIOS="hangul-word" style={[styles.memberMeta, { color: colors.textSecondary }]}>
                      {member.email}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  ref={element => {
                    if (element) rowButtons.current.set(member.memberId, element);
                    else rowButtons.current.delete(member.memberId);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${blockedMemberLabel(member)} 차단 해제`}
                  onPress={() => {
                    setUnblockFailure(null);
                    setConfirmation(member);
                  }}
                  style={({ pressed }) => [
                    styles.unblockButton,
                    { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <Text style={[styles.unblockText, !largeText && styles.rowActionText, { color: accent }]}>차단 해제</Text>
                </Pressable>
              </Animated.View>
            ))}
            {error && largeText && (
              <View accessibilityLiveRegion="polite" style={styles.refreshError}>
                <Text style={[styles.stateText, { color: colors.textSecondary }]}>{error}</Text>
                <Pressable accessibilityRole="button" disabled={refreshing} onPress={() => void load('retry')} style={styles.retryButton}>
                  <Text style={[styles.retryText, { color: colors.textPrimary }]}>다시 시도</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>
      {!largeText && noticeVisible ? (
        <View pointerEvents="none" style={[styles.noticePosition, { bottom: noticeBottom }]}>
          <Animated.View entering={reduceMotion ? undefined : backdropIn} style={styles.noticePill}>
            <Ionicons accessible={false} name="checkmark-circle-outline" size={17} color="#FFFFFF" />
            <Text accessibilityLiveRegion="polite" style={styles.noticeText}>{unblockNotice}</Text>
          </Animated.View>
        </View>
      ) : showRefreshError ? (
        <SharingRefreshRetryBanner
          bottom={noticeBottom}
          accent={accent}
          message={refreshing ? '차단 목록을 확인하고 있어요.' : '차단 목록을 새로고침하지 못했어요.'}
          refreshing={refreshing}
          retryTestID="sharing-blocks-refresh-retry"
          onRetry={() => void load('retry')}
        />
      ) : null}
      <Modal visible={confirmation !== null} transparent animationType="none" presentationStyle="overFullScreen"
        onShow={() => {
          if (confirmationHeading.current) AccessibilityInfo.sendAccessibilityEvent?.(confirmationHeading.current, 'focus');
        }}
        onRequestClose={dismissConfirmation} onDismiss={restoreFocus}>
        {confirmation && (
          <View style={styles.modalOverlay}>
            <Animated.View entering={reduceMotion ? undefined : backdropIn} style={StyleSheet.absoluteFill}>
              <Pressable accessible={false} importantForAccessibility="no" disabled={pending}
                onPress={dismissConfirmation} style={styles.backdrop} />
            </Animated.View>
            <Animated.View entering={reduceMotion ? undefined : confirmationIn} accessibilityViewIsModal
              onAccessibilityEscape={dismissConfirmation}
              style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(18, insets.bottom) }]}>
              <ScrollView bounces={false} contentContainerStyle={styles.confirmationContent}>
                <Text ref={confirmationHeading} accessible accessibilityRole="header"
                  style={[styles.sheetTitle, { color: colors.textPrimary }]}>차단을 해제할까요?</Text>
                <View style={[styles.confirmationMember, { backgroundColor: colors.surface2 }]}>
                  <Ionicons accessible={false} name="person-outline" size={20} color={colors.textSecondary} />
                  <View style={styles.copy}>
                    <Text style={[styles.memberName, { color: colors.textPrimary }]}>{blockedMemberLabel(confirmation)}</Text>
                    {!!confirmation.name && !!confirmation.email && (
                      <Text style={[styles.memberMeta, { color: colors.textSecondary }]}>{confirmation.email}</Text>
                    )}
                  </View>
                </View>
                <Text style={[styles.description, { color: colors.textSecondary }]}>
                  이 사용자가 보낸 공유를 다시 받을 수 있어요.
                </Text>
                {!!unblockFailure && <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
                  style={[styles.description, { color: colors.textPrimary }]}>{unblockFailure}</Text>}
              </ScrollView>
              <View style={[styles.sheetActions, largeText && styles.sheetActionsLarge]}>
                <Pressable accessibilityRole="button" disabled={pending} onPress={dismissConfirmation}
                  style={[styles.sheetButton, { backgroundColor: colors.surface2 }]}>
                  <Text style={[styles.unblockText, { color: colors.textPrimary }]}>취소</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={pending
                  ? '차단 해제 중'
                  : unblockFailure && !largeText ? '다시 시도' : '차단 해제 확인'}
                  accessibilityState={{ disabled: pending, busy: pending }} disabled={pending} onPress={applyUnblock}
                  style={[styles.sheetButton, { backgroundColor: accent }]}>
                  <Text style={[styles.unblockText, { color: actionInk }]}>
                    {pending ? '해제 중' : unblockFailure ? '다시 시도' : '차단 해제'}
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        )}
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  sectionRule: { borderBottomWidth: StyleSheet.hairlineWidth },
  sectionTopRule: { borderTopWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 44 },
  title: { flex: 1, fontSize: 21, lineHeight: 28, fontWeight: '700' },
  content: { paddingHorizontal: 18, paddingTop: 10 },
  description: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  state: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { fontSize: 14, lineHeight: 21, fontWeight: '500', textAlign: 'center' },
  emptyState: { minHeight: 0, marginTop: 18, paddingTop: 42, justifyContent: 'flex-start', gap: 12 },
  emptyTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  retryButton: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  list: { marginTop: 18 },
  refreshError: { paddingVertical: 12, alignItems: 'center' },
  count: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '600' },
  emptyIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 76, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowStandard: { minHeight: 70, paddingVertical: 10 },
  rowLarge: { flexWrap: 'wrap' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  memberMeta: { marginTop: 2, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  unblockButton: { minWidth: 76, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  unblockText: { fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  rowActionText: { fontSize: 13 },
  noticePosition: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  noticePill: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#222A35' },
  noticeText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#FFFFFF' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: { maxHeight: '80%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 18, paddingHorizontal: 18, gap: 12 },
  confirmationContent: { gap: 12 },
  sheetTitle: { fontSize: 21, fontWeight: '700' },
  confirmationMember: { borderRadius: 12, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  sheetActions: { flexDirection: 'row', gap: 10 },
  sheetActionsLarge: { flexDirection: 'column' },
  sheetButton: { flexGrow: 1, flexBasis: 0, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 10 },
});
