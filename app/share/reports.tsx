import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getMySharingReports,
  type SharingReport,
  type SharingReportReason,
  type SharingReportStatus,
} from '../../src/api/sharingSafety';
import { useTheme } from '../../src/modules/theme/ThemeContext';
import { useScreenFirstPaintPerformance } from '../../src/modules/performance/useScreenFirstPaintPerformance';
import { useImmediateNavigationTransition } from '../../src/modules/performance/ImmediateNavigationTransition';

const reportDetailsIn = FadeIn.duration(200).reduceMotion(ReduceMotion.System);

const REASON_LABEL: Record<SharingReportReason, string> = {
  UNWANTED_SHARING: '원치 않는 공유',
  HARASSMENT: '괴롭힘',
  SPAM: '스팸',
  INAPPROPRIATE_CONTENT: '부적절한 내용',
  PRIVACY_CONCERN: '개인정보 우려',
  OTHER: '기타',
};

const STATUS_LABEL: Record<SharingReportStatus, string> = {
  SUBMITTED: '접수됨',
  REVIEWING: '검토 중',
  RESOLVED: '처리 완료',
  DISMISSED: '검토 종료',
};

function formatDate(value?: string | null) {
  if (!value) return '접수 시각 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function resourceLabel(report: SharingReport) {
  if (report.resourceType === 'SCHEDULE') return `일정 #${report.resourceId}`;
  if (report.resourceType === 'CALENDAR') return `공유 캘린더 #${report.resourceId}`;
  return `카테고리 #${report.resourceId}`;
}

export default function SharingReportHistoryScreen() {
  useScreenFirstPaintPerformance('/share/reports');
  const router = useRouter();
  const { closeActiveScene } = useImmediateNavigationTransition();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const requestId = useRef(0);
  const [reports, setReports] = useState<SharingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    const request = ++requestId.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const next = await getMySharingReports();
      if (request === requestId.current) {
        setReports(next);
        setExpandedId(id => next.some(report => report.id === id) ? id : null);
      }
    } catch (loadError) {
      if (request === requestId.current) {
        setError(loadError instanceof Error ? loadError.message : '신고 내역을 불러오지 못했습니다.');
      }
    } finally {
      if (request === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="공유함으로 돌아가기"
          onPress={() => {
            if (closeActiveScene()) return;
            if (router.canGoBack()) router.back();
            else router.replace('/share/inbox');
          }}
          style={styles.headerButton}
        >
          <Ionicons name="chevron-back-outline" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>내 신고 내역</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="신고 내역 새로고침"
          accessibilityState={{ disabled: loading || refreshing, busy: refreshing }}
          disabled={loading || refreshing} onPress={() => load(true)} style={styles.headerButton}>
          <Ionicons accessible={false} name="refresh-outline" size={22} color={colors.textPrimary} />
        </Pressable>
      </View>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
      >
        <Text style={[styles.description, { color: colors.textSecondary }]}>접수한 공유 신고의 현재 처리 상태를 확인할 수 있어요.</Text>
        {loading ? (
          <View accessibilityRole="progressbar" style={styles.state}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>신고 내역을 확인하고 있어요</Text>
          </View>
        ) : error && reports.length === 0 ? (
          <View accessibilityRole="alert" style={styles.state}>
            <Ionicons name="alert-circle-outline" size={25} color={colors.textSecondary} />
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => load()} style={styles.retry}>
              <Text style={[styles.retryText, { color: colors.textPrimary }]}>다시 시도</Text>
            </Pressable>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.state}>
            <Ionicons name="flag-outline" size={30} color={colors.textSecondary} />
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>접수한 신고가 없어요</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {error && (
              <View accessibilityLiveRegion="polite" style={styles.refreshError}>
                <Text style={[styles.stateText, { color: colors.textSecondary }]}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={() => load(true)} style={styles.retry}>
                  <Text style={[styles.retryText, { color: colors.textPrimary }]}>다시 시도</Text>
                </Pressable>
              </View>
            )}
            <Text style={[styles.meta, { color: colors.textSecondary }]}>신고 {reports.length}건</Text>
            {reports.map(report => {
              const accent = report.status === 'RESOLVED'
                ? (mode === 'dark' ? '#6CDBA2' : '#0F7B43')
                : report.status === 'DISMISSED' ? colors.textSecondary
                  : (mode === 'dark' ? '#75B5FF' : '#1E5CC6');
              const expanded = expandedId === report.id;
              const reason = REASON_LABEL[report.reason];
              const status = STATUS_LABEL[report.status];
              const target = resourceLabel(report);
              const received = formatDate(report.createdAt);
              return (
                <View key={report.id} style={[styles.card, { borderColor: colors.border }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${reason}, ${status}, ${target}, 접수 ${received}`}
                    accessibilityState={{ expanded }}
                    accessibilityHint={expanded ? '신고 상세 접기' : '신고 상세 펼치기'}
                    onPress={() => setExpandedId(current => current === report.id ? null : report.id)}
                    style={({ pressed }) => [styles.reportButton, pressed && { opacity: 0.7 }]}
                  >
                    <View style={styles.reportCopy}>
                      <Text style={[styles.reason, { color: colors.textPrimary }]}>{reason}</Text>
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>{target}</Text>
                      <Text style={[styles.meta, { color: colors.textSecondary }]}>접수 {received}</Text>
                    </View>
                    <View style={[styles.status, { backgroundColor: `${accent}18` }]}>
                      <Text style={[styles.statusText, { color: accent }]}>{status}</Text>
                    </View>
                    <Ionicons accessible={false} name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                      size={16} color={colors.textSecondary} />
                  </Pressable>
                  {expanded && (
                    <Animated.View entering={reportDetailsIn} style={[styles.detailPanel, { backgroundColor: colors.surface2 }]}>
                      <Text style={[styles.reason, { color: colors.textPrimary }]}>신고 내용</Text>
                      <Text style={[styles.details, { color: colors.textPrimary }]}>
                        {report.details?.trim() || '추가로 남긴 내용이 없어요.'}
                      </Text>
                      {report.resolvedAt && (
                        <Text style={[styles.meta, { color: colors.textSecondary }]}>처리 시각 {formatDate(report.resolvedAt)}</Text>
                      )}
                    </Animated.View>
                  )}
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
  title: { flex: 1, fontSize: 21, lineHeight: 28, fontWeight: '700' },
  content: { paddingHorizontal: 18, paddingTop: 10 },
  description: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  state: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { fontSize: 14, lineHeight: 21, fontWeight: '500', textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  retryText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  list: { marginTop: 18 },
  refreshError: { alignItems: 'flex-start', paddingBottom: 12 },
  card: { borderBottomWidth: StyleSheet.hairlineWidth },
  reportButton: { minHeight: 72, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  reportCopy: { flex: 1, flexBasis: '45%', minWidth: 0, gap: 2 },
  reason: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 18, fontWeight: '400' },
  detailPanel: { borderRadius: 12, marginBottom: 12, padding: 12, gap: 6 },
  details: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
});
