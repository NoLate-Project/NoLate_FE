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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getMySharingReports,
  type SharingReport,
  type SharingReportReason,
  type SharingReportStatus,
} from '../../src/api/sharingSafety';
import { useTheme } from '../../src/modules/theme/ThemeContext';

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const mountedRef = useRef(true);
  const [reports, setReports] = useState<SharingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const next = await getMySharingReports();
      if (mountedRef.current) setReports(next);
    } catch (loadError) {
      if (mountedRef.current) {
        setError(loadError instanceof Error ? loadError.message : '신고 내역을 불러오지 못했습니다.');
      }
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

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="공유함으로 돌아가기"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/share/inbox'))}
          style={styles.headerButton}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]}>내 신고 내역</Text>
        <View style={styles.headerButton} />
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
        ) : error ? (
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
            {reports.map(report => {
              const accent = report.status === 'RESOLVED' ? '#18A558' : report.status === 'DISMISSED' ? colors.textSecondary : '#2F80FF';
              return (
                <View key={report.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardTop}>
                    <Text style={[styles.reason, { color: colors.textPrimary }]}>{REASON_LABEL[report.reason]}</Text>
                    <View style={[styles.status, { backgroundColor: `${accent}18` }]}>
                      <Text style={[styles.statusText, { color: accent }]}>{STATUS_LABEL[report.status]}</Text>
                    </View>
                  </View>
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>{resourceLabel(report)} · {formatDate(report.createdAt)}</Text>
                  {report.details ? <Text style={[styles.details, { color: colors.textPrimary }]}>{report.details}</Text> : null}
                  {report.resolvedAt ? <Text style={[styles.resolved, { color: colors.textSecondary }]}>처리 시각 {formatDate(report.resolvedAt)}</Text> : null}
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
  title: { flex: 1, textAlign: 'center', fontSize: 21, lineHeight: 28, fontWeight: '900' },
  content: { paddingHorizontal: 18, paddingTop: 10 },
  description: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  state: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  retry: { minHeight: 40, paddingHorizontal: 16, justifyContent: 'center' },
  retryText: { fontWeight: '800' },
  list: { marginTop: 18, gap: 11 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 15 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reason: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  status: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 11, lineHeight: 14, fontWeight: '800' },
  meta: { marginTop: 7, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  details: { marginTop: 12, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  resolved: { marginTop: 10, fontSize: 11, lineHeight: 15, fontWeight: '600' },
});
