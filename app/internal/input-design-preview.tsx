import React, { useState } from 'react';
import { ScheduleInputDesignPreviewProvider } from '../../src/modules/schedule/components/form/ScheduleInputDesignPreviewContext';
import { Alert, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import CalendarMainPreview from '../../src/routeSupport/internal/CalendarMainPreview';
import QuickScheduleModal from '../../src/modules/schedule/components/form/QuickScheduleModal';
import ScheduleAddModal from '../../src/modules/schedule/components/form/ScheduleAddModal';
import type { ScheduleParseResult } from '../../src/modules/schedule/types';

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
            step === 'preview'
              ? '10월 12일 오후 2시 성수 오피스에서 프로덕트 주간 회의'
              : undefined
          }
          initialRequestId={step === 'preview' ? 'input-review' : undefined}
          onAnalyze={async () => {
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
          initialValues={step === 'filled' ? parsed : undefined}
          onSubmit={() =>
            Alert.alert('검토용 일정', '저장 동작을 확인했습니다.')
          }
          onClose={() => setVisible(false)}
        />
      )}
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
const styles = StyleSheet.create({ root: { flex: 1 } });
