import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
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
import { usePreMountedSceneActivity } from '../../src/modules/performance/preMountedSceneActivity';
import { SharingRefreshRetryBanner } from '../../src/routeSupport/share/SharingRefreshRetryBanner';
import { BrandedLoadingState } from '../../src/ui/BrandedLoader';

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
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { closeActiveScene } = useImmediateNavigationTransition();
  const sceneActive = usePreMountedSceneActivity();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const standardText = useWindowDimensions().fontScale <= 1.35;
  const noticeAccent = mode === 'dark' ? '#75B5FF' : '#2563EB';
  const requestId = useRef(0);
  const requestInFlight = useRef(false);
  const loaded = useRef(false);
  const [reports, setReports] = useState<SharingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollView = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const rowOffsets = useRef(new Map<number, number>());
  const rowAnchor = useRef<{ id: number; contentY: number; scrollY: number } | null>(null);

  const load = useCallback(async (source: 'initial' | 'resume' | 'button' | 'pull' = 'initial') => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const request = ++requestId.current;
    setRefreshNotice(null);
    if (source === 'initial') {
      setLoading(true);
      setError(null);
    } else {
      setRefreshing(true);
      setPullRefreshing(source === 'pull');
    }
    try {
      const next = await getMySharingReports();
      if (request === requestId.current) {
        rowAnchor.current = null;
        setReports(next);
        loaded.current = true;
        setExpandedId(id => next.some(report => report.id === id) ? id : null);
        setError(null);
        if (source === 'button' || source === 'pull') setRefreshNotice(request);
      }
    } catch (loadError) {
      if (request === requestId.current) {
        setError(loadError instanceof Error ? loadError.message : '신고 내역을 불러오지 못했습니다.');
      }
    } finally {
      if (request === requestId.current) {
        requestInFlight.current = false;
        setLoading(false);
        setRefreshing(false);
        setPullRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (sceneActive === false) {
      rowAnchor.current = null;
      requestId.current += 1;
      requestInFlight.current = false;
      setRefreshing(false);
      setPullRefreshing(false);
      setRefreshNotice(null);
      return;
    }
    void load(loaded.current ? 'resume' : 'initial');
  }, [load, sceneActive]);

  useEffect(() => {
    if (refreshNotice === null) return;
    const timeout = setTimeout(() => setRefreshNotice(null), 2000);
    return () => clearTimeout(timeout);
  }, [refreshNotice]);

  useEffect(() => {
    return () => {
      requestId.current += 1;
      requestInFlight.current = false;
    };
  }, []);

  const toggleReport = (id: number) => {
    const contentY = rowOffsets.current.get(id);
    const expandedY = expandedId === null ? undefined : rowOffsets.current.get(expandedId);
    const scrollY = scrollOffset.current;
    // Closing a report above the pressed row removes its detail height from the list.
    rowAnchor.current = standardText && scrollY > 0 && contentY !== undefined &&
      expandedY !== undefined && expandedY < contentY ? { id, contentY, scrollY } : null;
    setExpandedId(expandedId === id ? null : id);
  };

  const recordReportLayout = (id: number, contentY: number) => {
    rowOffsets.current.set(id, contentY);
    const anchor = rowAnchor.current;
    if (anchor?.id !== id || anchor.contentY === contentY) return;
    rowAnchor.current = null;
    scrollView.current?.scrollTo({ y: Math.max(0, anchor.scrollY + contentY - anchor.contentY), animated: false });
  };

  const showRefreshError = standardText && !loading && reports.length > 0 && error !== null;
  const noticeBottom = Math.max(18, insets.bottom) + 12;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={from === 'safety' ? '공유 안전 관리로 돌아가기' : '공유함으로 돌아가기'}
          onPress={() => {
            if (closeActiveScene()) return;
            if (router.canGoBack()) router.back();
            else router.replace(from === 'safety' ? '/share/safety' : '/share/inbox');
          }}
          style={styles.headerButton}
        >
          <Ionicons name="chevron-back-outline" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={[styles.title, { color: colors.textPrimary }]}>내 신고 내역</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="신고 내역 새로고침"
          accessibilityState={{ disabled: loading || refreshing, busy: refreshing }}
          disabled={loading || refreshing} onPress={() => load('button')} style={styles.headerButton}>
          <Ionicons accessible={false} name="refresh-outline" size={22}
            color={refreshing ? colors.textSecondary : colors.textPrimary} />
        </Pressable>
      </View>
      <ScrollView
        ref={scrollView}
        testID="sharing-reports-scroll"
        onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
        onScrollBeginDrag={() => { rowAnchor.current = null; }}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={() => load('pull')} />}
        contentContainerStyle={[styles.content, { paddingBottom: showRefreshError ? noticeBottom + 66 : Math.max(insets.bottom, 20) + 24 }]}
      >
        {loading ? (
          <BrandedLoadingState style={styles.state} accessibilityLabel="신고 내역을 확인하고 있어요"
            title="신고 내역을 확인하고 있어요" />
        ) : reports.length === 0 ? (
          <View style={[styles.state, standardText && styles.notice]}>
            <View
              accessible={false}
              style={standardText ? [styles.noticeIcon, { backgroundColor: colors.surface2 }] : undefined}
            >
              <Ionicons
                accessible={false}
                name={error ? 'alert-circle-outline' : 'flag-outline'}
                size={standardText ? 24 : error ? 25 : 30}
                color={standardText ? noticeAccent : colors.textSecondary}
              />
            </View>
            <Text
              accessibilityRole={error ? 'alert' : undefined}
              accessibilityLiveRegion={error ? 'polite' : 'none'}
              style={[
                styles.stateText,
                standardText && styles.noticeTitle,
                { color: standardText ? colors.textPrimary : colors.textSecondary },
              ]}
            >
              {error
                ? standardText ? '신고 내역을 불러오지 못했어요.' : error
                : '접수한 신고가 없어요'}
            </Text>
            {error ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="다시 시도"
                onPress={() => load()}
                style={({ pressed }) => [
                  styles.retry,
                  standardText && styles.noticeRetry,
                  standardText && { borderColor: colors.border, backgroundColor: colors.surface },
                  pressed && styles.retryPressed,
                ]}
              >
                <Text style={[styles.retryText, { color: standardText ? noticeAccent : colors.textPrimary }]}>
                  다시 시도
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={[styles.meta, styles.count, { color: colors.textSecondary, borderBottomColor: colors.border }]}>신고 {reports.length}건</Text>
            {reports.map(report => {
              const accent = report.status === 'RESOLVED'
                ? (mode === 'dark' ? '#6CDBA2' : '#0F7B43')
                : report.status === 'REVIEWING' ? (mode === 'dark' ? '#B0BFFF' : '#3E54A0')
                  : report.status === 'DISMISSED' ? colors.textSecondary
                    : (mode === 'dark' ? '#75B5FF' : '#1E5CC6');
              const expanded = expandedId === report.id;
              const reason = REASON_LABEL[report.reason];
              const status = STATUS_LABEL[report.status];
              const target = resourceLabel(report);
              const received = formatDate(report.createdAt);
              return (
                <View key={report.id} testID={`sharing-report-row-${report.id}`}
                  onLayout={event => recordReportLayout(report.id, event.nativeEvent.layout.y)}
                  style={[styles.card, { borderColor: colors.border }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${reason}, ${status}, ${target}, 접수 ${received}`}
                    accessibilityState={{ expanded }}
                    accessibilityHint={expanded ? '신고 상세 접기' : '신고 상세 펼치기'}
                    onPress={() => toggleReport(report.id)}
                    style={({ pressed }) => [
                      styles.reportButton,
                      expanded && { backgroundColor: colors.surface2 },
                      pressed && { opacity: 0.7 },
                    ]}
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
                    <Animated.View testID={`sharing-report-details-${report.id}`} entering={reportDetailsIn} style={[styles.detailPanel, { backgroundColor: colors.surface2 }]}>
                      <Text style={[styles.reason, { color: colors.textPrimary }]}>신고 내용</Text>
                      <Text lineBreakStrategyIOS="hangul-word" style={[styles.details, { color: colors.textPrimary }]}>
                        {report.details?.trim() || '추가로 남긴 내용이 없어요.'}
                      </Text>
                      {report.resolvedAt && (
                        <Text style={[styles.meta, styles.resolvedAt, { color: colors.textSecondary, borderTopColor: colors.border }]}>처리 시각 {formatDate(report.resolvedAt)}</Text>
                      )}
                    </Animated.View>
                  )}
                </View>
              );
            })}
            {error && !standardText && (
              <View accessibilityLiveRegion="polite" style={styles.refreshError}>
                <Text style={[styles.stateText, { color: colors.textSecondary }]}>{error}</Text>
                <Pressable testID="sharing-reports-refresh-retry" accessibilityRole="button" accessibilityState={{ disabled: refreshing }}
                  disabled={refreshing} onPress={() => load('button')} style={styles.retry}>
                  <Text style={[styles.retryText, { color: colors.textPrimary }]}>다시 시도</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>
      {showRefreshError ? (
        <SharingRefreshRetryBanner
          bottom={noticeBottom}
          accent={noticeAccent}
          message={refreshing ? '신고 내역을 확인하고 있어요.' : '신고 내역을 새로고침하지 못했어요.'}
          refreshing={refreshing}
          retryTestID="sharing-reports-refresh-retry"
          onRetry={() => void load('button')}
        />
      ) : standardText && refreshNotice !== null ? (
        <View pointerEvents="none" style={[styles.noticePosition, { bottom: noticeBottom }]}>
          <Text accessibilityLiveRegion="polite" style={styles.refreshSuccess}>신고 내역을 새로고침했어요.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 21, lineHeight: 28, fontWeight: '700' },
  content: { paddingHorizontal: 18, paddingTop: 10 },
  state: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { fontSize: 14, lineHeight: 21, fontWeight: '500', textAlign: 'center' },
  notice: { minHeight: 0, paddingTop: 56, paddingBottom: 24, justifyContent: 'flex-start', gap: 12 },
  noticeIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  noticeTitle: { fontWeight: '700' },
  retry: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  retryText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  noticeRetry: { borderRadius: 10, borderWidth: 1 },
  retryPressed: { opacity: 0.65 },
  list: { marginTop: 18 },
  count: { paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth, fontWeight: '600' },
  refreshError: { alignItems: 'flex-start', paddingTop: 12 },
  noticePosition: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  refreshSuccess: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, overflow: 'hidden', backgroundColor: '#222A35', color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  card: { borderBottomWidth: StyleSheet.hairlineWidth },
  reportButton: { minHeight: 72, paddingVertical: 12, paddingHorizontal: 3, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderRadius: 8 },
  reportCopy: { flex: 1, flexBasis: '45%', minWidth: 0, gap: 2 },
  reason: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  status: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 18, fontWeight: '400' },
  detailPanel: { borderRadius: 12, marginTop: 6, marginBottom: 12, padding: 12, gap: 6 },
  details: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  resolvedAt: { marginTop: 4, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth },
});
