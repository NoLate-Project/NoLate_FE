import React, { useState } from 'react';
import { ScheduleInputDesignPreviewProvider } from '../../src/modules/schedule/components/form/ScheduleInputDesignPreviewContext';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import CalendarMainPreview from '../../src/routeSupport/internal/CalendarMainPreview';
import QuickScheduleModal from '../../src/modules/schedule/components/form/QuickScheduleModal';
import ScheduleAddModal from '../../src/modules/schedule/components/form/ScheduleAddModal';
import type { ScheduleParseResult } from '../../src/modules/schedule/types';
import BrandedLoader, { BrandedLoadingState } from '../../src/ui/BrandedLoader';
import { useTheme } from '../../src/modules/theme/ThemeContext';

import IntercityTimetableSheet from '../../src/modules/schedule/components/route/IntercityTimetableSheet';

function TimetablePreview() {
  const router = useRouter();
  const { mode } = useTheme();
  const [visible, setVisible] = useState(true);
  return (
    <IntercityTimetableSheet
      visible={visible}
      kind="TRAIN"
      date={new Date('2099-10-13T12:00:00+09:00')}
      departureName="수서"
      arrivalName="공주"
      dark={mode === 'dark'}
      importedTicket={{
        version: 1, id: 'ticket:12345678-1234-1234-1234-123456789012',
        kind: 'TRAIN', source: 'IOS_SHARE_TEXT', verification: 'USER_CONFIRMED',
        bookingStatus: 'UNVERIFIED', departureName: '수서', arrivalName: '공주',
        departureAt: '2099-10-13T12:20:00+09:00', arrivalAt: '2099-10-13T13:12:00+09:00',
        trainNumber: '615', grade: 'SRT', confirmedAt: '2099-10-13T10:00:00+09:00',
      }}
      onClose={() => {
        setVisible(false);
        if (Platform.OS !== 'ios') router.replace('/schedule');
      }}
      onDismiss={() => router.replace('/schedule')}
      onSelect={async () => undefined}
    />
  );
}

const categories = [
  { id: 'input-preview-work', title: '업무', color: '#4C88FF' },
  { id: 'input-preview-personal', title: '개인', color: '#FF7181' },
];
const parsed: ScheduleParseResult = {
  title: '프로덕트 주간 회의',
  startAt: '2026-10-12T14:00:00+09:00',
  endAt: '2026-10-12T15:00:00+09:00',
  hasExplicitEndTime: true,
  destination: { name: '성수 오피스' },
  originSource: 'TEXT',
  originRequired: false,
  parseSource: 'RULE',
  aiAttempted: false,
  needsReview: false,
  warnings: [],
  missingFields: [],
};

/** Actual input components with local fixtures; no account or API writes. */
function InputPreview({
  panel,
  step,
  scenario,
}: {
  panel: string;
  step?: string;
  scenario?: 'normal' | 'error';
}) {
  const [visible, setVisible] = useState(true);
  const showExample = step === 'preview' || step === 'loading';
  return (
    <View style={styles.root}>
      <View
        accessibilityElementsHidden={panel !== 'search' && visible}
        importantForAccessibility={
          panel !== 'search' && visible ? 'no-hide-descendants' : 'auto'
        }
        style={styles.root}
      >
        <CalendarMainPreview
          initialMode="detail"
          searchPreview={panel === 'search'}
          scenario={scenario}
        />
      </View>
      {panel === 'quick' && (
        <QuickScheduleModal
          visible={visible}
          defaultDay="2026-10-12"
          defaultCategory={categories[0]}
          categories={categories}
          initialText={
            showExample
              ? '10월 12일 오후 2시 성수 오피스에서 프로덕트 주간 회의'
              : undefined
          }
          initialRequestId={showExample ? `input-review-${step}` : undefined}
          onAnalyze={async () => {
            if (step === 'loading') await new Promise<void>(resolve => setTimeout(resolve, 15_000));
            if (scenario === 'error')
              throw new Error('일정 내용을 읽지 못했어요. 다시 시도해 주세요.');
            return parsed;
          }}
          onSave={() => undefined}
          onClose={() => setVisible(false)}
        />
      )}
      {panel === 'create' && (
        <ScheduleAddModal
          visible={visible}
          presentation="morph"
          defaultDay="2026-10-12"
          categories={categories}
          initialValues={step === 'filled' || step === 'saving' ? parsed : undefined}
          onSubmit={async () => {
            if (step === 'saving') await new Promise<void>(resolve => setTimeout(resolve, 3_000));
            Alert.alert('검토용 일정', '저장 동작을 확인했습니다.');
          }}
          onClose={() => setVisible(false)}
        />
      )}
    </View>
  );
}

function LoaderPreview() {
  const { colors } = useTheme();
  return (
    <View style={[styles.loaderPreview, { backgroundColor: colors.background }]}>
      <BrandedLoadingState size="full" accessibilityLabel="일정을 불러오는 중이에요" title="일정을 불러오는 중이에요" />
      <BrandedLoadingState size="section" accessibilityLabel="경로를 불러오는 중이에요" title="경로를 불러오는 중이에요" />
      <View accessible accessibilityRole="button" accessibilityLabel="저장 중"
        accessibilityState={{ busy: true, disabled: true }} style={styles.loaderPreviewButton}>
        <Text style={styles.loaderPreviewButtonText}>저장 중</Text>
        <BrandedLoader size="button" tone="inverse" accessibilityLabel="저장 중" />
      </View>
    </View>
  );
}

export default function InputDesignPreviewScreen() {
  const params = useLocalSearchParams<{
    panel?: string;
    step?: string;
    scenario?: 'normal' | 'error';
    variant?: 'original' | 'toss';
  }>();
  if (!__DEV__) return null;
  if (params.panel === 'loading') return <LoaderPreview />;
  if (params.panel === 'timetable') return <TimetablePreview />;
  return (
    <ScheduleInputDesignPreviewProvider value={params.variant === 'toss'}>
      <InputPreview
        key={`${params.panel}-${params.step}-${params.scenario}-${params.variant}`}
        panel={params.panel ?? 'quick'}
        step={params.step}
        scenario={params.scenario}
      />
    </ScheduleInputDesignPreviewProvider>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  loaderPreview: { flex: 1, justifyContent: 'center', gap: 26, paddingHorizontal: 24 },
  loaderPreviewButton: {
    minHeight: 48, paddingHorizontal: 18, alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, borderRadius: 12, backgroundColor: '#246BFE',
  },
  loaderPreviewButtonText: { color: '#FFFFFF', fontWeight: '700' },
});
