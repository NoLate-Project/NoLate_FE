import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getBlockedSharingMembers,
  unblockSharingMember,
  type BlockedSharingMember,
} from '../../src/api/sharingSafety';
import { recoverDepartureAlarmsAfterMutation } from '../../src/modules/notification/departureAlarmMutationRecovery';
import { useTheme } from '../../src/modules/theme/ThemeContext';

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '차단 목록을 불러오지 못했습니다.';
  if (/network|timeout/i.test(message)) return '네트워크 상태를 확인해 주세요.';
  return message;
}

function blockedMemberLabel(member: BlockedSharingMember) {
  return member.name?.trim() || member.email?.trim() || `회원 #${member.memberId}`;
}

export default function BlockedSharingMembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const mountedRef = useRef(true);
  const [members, setMembers] = useState<BlockedSharingMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingMemberId, setPendingMemberId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/share/inbox');
  }, [router]);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const next = await getBlockedSharingMembers();
      if (mountedRef.current) setMembers(next);
    } catch (loadError) {
      if (mountedRef.current) setError(errorMessage(loadError));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load().catch(() => undefined);
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const confirmUnblock = useCallback((member: BlockedSharingMember) => {
    if (pendingMemberId !== null) return;
    Alert.alert(
      '차단 해제',
      `${blockedMemberLabel(member)} 사용자의 공유를 다시 받을 수 있게 할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '차단 해제',
          onPress: async () => {
            setPendingMemberId(member.memberId);
            try {
              await unblockSharingMember(member.memberId);
              await recoverDepartureAlarmsAfterMutation();
              if (mountedRef.current) {
                setMembers(current => current.filter(item => item.memberId !== member.memberId));
              }
            } catch (unblockError) {
              Alert.alert('차단 해제 실패', errorMessage(unblockError));
            } finally {
              if (mountedRef.current) setPendingMemberId(null);
            }
          },
        },
      ],
    );
  }, [pendingMemberId]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="공유함으로 돌아가기"
          onPress={goBack}
          style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]}>차단한 사용자</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
        }
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}
      >
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          차단한 사용자의 기존 공유는 숨겨지고 새로운 직접 공유와 링크 초대도 거절됩니다.
        </Text>

        {loading ? (
          <View accessibilityRole="progressbar" style={styles.state}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>차단 목록을 확인하고 있어요</Text>
          </View>
        ) : error ? (
          <View accessibilityRole="alert" style={styles.state}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.textSecondary} />
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => load()} style={styles.retryButton}>
              <Text style={[styles.retryText, { color: colors.textPrimary }]}>다시 시도</Text>
            </Pressable>
          </View>
        ) : members.length === 0 ? (
          <View style={styles.state}>
            <Ionicons name="shield-checkmark-outline" size={30} color={colors.textSecondary} />
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>차단한 사용자가 없어요</Text>
          </View>
        ) : (
          <View style={[styles.list, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {members.map((member, index) => {
              const pending = pendingMemberId === member.memberId;
              return (
                <View
                  key={member.memberId}
                  style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                >
                  <View style={[styles.avatar, { backgroundColor: colors.surface2 }]}>
                    <Ionicons name="person-outline" size={19} color={colors.textSecondary} />
                  </View>
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={[styles.memberName, { color: colors.textPrimary }]}>
                      {blockedMemberLabel(member)}
                    </Text>
                    {member.email && member.name ? (
                      <Text numberOfLines={1} style={[styles.memberMeta, { color: colors.textSecondary }]}>
                        {member.email}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${blockedMemberLabel(member)} 차단 해제`}
                    accessibilityState={{ busy: pending, disabled: pendingMemberId !== null }}
                    disabled={pendingMemberId !== null}
                    onPress={() => confirmUnblock(member)}
                    style={({ pressed }) => [
                      styles.unblockButton,
                      { borderColor: colors.border, opacity: pressed || pendingMemberId !== null ? 0.5 : 1 },
                    ]}
                  >
                    {pending ? (
                      <ActivityIndicator size="small" color={colors.textSecondary} />
                    ) : (
                      <Text style={[styles.unblockText, { color: colors.textPrimary }]}>차단 해제</Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 44 },
  title: { flex: 1, textAlign: 'center', fontSize: 21, lineHeight: 28, fontWeight: '900' },
  content: { paddingHorizontal: 18, paddingTop: 10 },
  description: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  state: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  retryButton: { minHeight: 40, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontWeight: '800' },
  list: { marginTop: 18, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  row: { minHeight: 76, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  memberMeta: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  unblockButton: { minWidth: 76, height: 38, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  unblockText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
});
