import { Ionicons } from '@expo/vector-icons';
import { Image, Platform, Text, View } from 'react-native';

import NoLateLoadingMark from '../../ui/NoLateLoadingMark';
import type { AppColors } from '../../modules/theme/ThemeContext';
import { ProviderOptionRow } from './CalendarImportCandidates';
import {
  CalendarConsentChecklist,
  StepIcon,
} from './CalendarImportConsent';
import {
  CURATION_APP_LOGO,
  SCAN_MESSAGES,
  type CalendarConsentId,
  type CalendarConsentItem,
  type CalendarProviderId,
  type CalendarProviderOption,
  type OnboardingStep,
} from './calendarImportModel';
import type { createCalendarImportStyles } from './calendarImportStyles';

type CalendarImportEarlyStepsProps = {
  step: OnboardingStep;
  styles: ReturnType<typeof createCalendarImportStyles>;
  colors: AppColors;
  providerOptions: CalendarProviderOption[];
  selectedProviderIds: Set<CalendarProviderId>;
  onToggleProvider: (id: CalendarProviderId) => void;
  permissionProviderLabel: string;
  calendarConsentItems: CalendarConsentItem[];
  acceptedCalendarConsentIds: Set<CalendarConsentId>;
  expandedCalendarConsentIds: Set<CalendarConsentId>;
  allCalendarConsentsAccepted: boolean;
  onToggleAllCalendarConsents: () => void;
  onToggleCalendarConsent: (id: CalendarConsentId) => void;
  onToggleCalendarConsentDetail: (id: CalendarConsentId) => void;
  errorMessage: string | null;
  scanStage: number;
  scanStatusMessage: string;
};

/** 소개부터 공급자 선택, 동의, 스캔까지의 초기 큐레이션 단계를 표시합니다. */
export default function CalendarImportEarlySteps({
  step,
  styles,
  colors,
  providerOptions,
  selectedProviderIds,
  onToggleProvider,
  permissionProviderLabel,
  calendarConsentItems,
  acceptedCalendarConsentIds,
  expandedCalendarConsentIds,
  allCalendarConsentsAccepted,
  onToggleAllCalendarConsents,
  onToggleCalendarConsent,
  onToggleCalendarConsentDetail,
  errorMessage,
  scanStage,
  scanStatusMessage,
}: CalendarImportEarlyStepsProps) {
  return (
    <>
      {step === 'intro' && (
        <View style={[styles.stepWrap, styles.introWrap]}>
          <View style={styles.introLogoWrap}>
            <Image
              source={CURATION_APP_LOGO}
              resizeMode="cover"
              style={styles.introLogoImage}
            />
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            캘린더 일정 가져오기
          </Text>
          <Text style={styles.subtitle}>
            선택한 일정만 NoLate에 복사해요.
          </Text>

        </View>
      )}

      {step === 'provider' && (
        <View style={styles.stepWrap}>
          <Text accessibilityRole="header" style={styles.title}>어느 캘린더에서{'\n'}가져올까요?</Text>
          <Text style={styles.subtitle}>
            여러 캘린더를 함께 선택할 수 있어요.
          </Text>

          <View style={styles.providerList}>
            {providerOptions.map(provider => (
              <ProviderOptionRow
                key={provider.id}
                provider={provider}
                selected={selectedProviderIds.has(provider.id)}
                onPress={() => onToggleProvider(provider.id)}
              />
            ))}
          </View>
        </View>
      )}

      {step === 'permission' && (
        <View style={styles.stepWrap}>
          <StepIcon
            name={
              Platform.OS === 'ios'
                ? 'calendar-outline'
                : 'phone-portrait-outline'
            }
          />
          <Text accessibilityRole="header" style={styles.title}>
            {permissionProviderLabel}의{'\n'}일정을 확인할게요
          </Text>
          <Text style={styles.subtitle}>
            읽는 정보와 저장 범위를 먼저 확인해 주세요.
          </Text>
          {errorMessage ? (
            <View accessibilityLiveRegion="polite" style={styles.inlineNotice}>
              <Ionicons accessible={false} importantForAccessibility="no"
                name="information-circle-outline"
                size={18}
                color={colors.textSecondary}
              />
              <Text style={styles.inlineNoticeText}>{errorMessage}</Text>
            </View>
          ) : null}
          <CalendarConsentChecklist
            items={calendarConsentItems}
            acceptedIds={acceptedCalendarConsentIds}
            expandedIds={expandedCalendarConsentIds}
            allAccepted={allCalendarConsentsAccepted}
            onToggleAll={onToggleAllCalendarConsents}
            onToggleItem={onToggleCalendarConsent}
            onToggleDetail={onToggleCalendarConsentDetail}
          />
        </View>
      )}

      {step === 'scanning' && (
        <View style={styles.stepWrap}>
          <View style={styles.centeredStatusHeader}>
            <View accessible accessibilityRole="progressbar" accessibilityLabel="캘린더 가져오기"
              accessibilityValue={{ min: 1, now: scanStage + 1, max: SCAN_MESSAGES.length, text: SCAN_MESSAGES[scanStage] }}>
              <NoLateLoadingMark size={82} delayMs={0} />
            </View>
            <Text accessibilityRole="header" style={[styles.title, { textAlign: 'center' }]}>가져올 일정을{'\n'}찾고 있어요</Text>
            <Text style={[styles.subtitle, { textAlign: 'center' }]}>
              {scanStatusMessage}
            </Text>
          </View>
        </View>
      )}
    </>
  );
}
