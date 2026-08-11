import { Ionicons } from '@expo/vector-icons';
import { Image, Platform, Text, View } from 'react-native';

import QuickScheduleLogoLoader from '../../modules/schedule/components/form/QuickScheduleLogoLoader';
import type { AppColors } from '../../modules/theme/ThemeContext';
import { ProviderOptionRow } from './CalendarImportCandidates';
import {
  CalendarConsentChecklist,
  IntroPoint,
  StepIcon,
} from './CalendarImportConsent';
import {
  BRAND_BLUE,
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
          <Text style={styles.title}>
            캘린더를 연결하면{'\n'}출발 준비가 쉬워져요
          </Text>
          <Text style={styles.subtitle}>
            일정을 가져오면 필요한 출발 시간까지 한 번에 준비할 수 있어요.
          </Text>

          <View style={styles.introPointList}>
            <IntroPoint label="원본 캘린더 일정은 바뀌지 않아요" />
            <IntroPoint label="가져올 일정은 직접 확인할 수 있어요" />
          </View>
        </View>
      )}

      {step === 'provider' && (
        <View style={styles.stepWrap}>
          <Text style={styles.eyebrow}>캘린더 가져오기</Text>
          <Text style={styles.title}>어느 캘린더에서{'\n'}가져올까요?</Text>
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
          <Text style={styles.title}>
            {permissionProviderLabel}의{'\n'}일정을 확인할게요
          </Text>
          <Text style={styles.subtitle}>
            읽는 정보와 저장 범위를 먼저 확인해 주세요.
          </Text>
          <CalendarConsentChecklist
            items={calendarConsentItems}
            acceptedIds={acceptedCalendarConsentIds}
            expandedIds={expandedCalendarConsentIds}
            allAccepted={allCalendarConsentsAccepted}
            onToggleAll={onToggleAllCalendarConsents}
            onToggleItem={onToggleCalendarConsent}
            onToggleDetail={onToggleCalendarConsentDetail}
          />
          {errorMessage ? (
            <View accessibilityLiveRegion="polite" style={styles.inlineNotice}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={colors.textSecondary}
              />
              <Text style={styles.inlineNoticeText}>{errorMessage}</Text>
            </View>
          ) : null}
        </View>
      )}

      {step === 'scanning' && (
        <View style={styles.stepWrap}>
          <QuickScheduleLogoLoader
            variant="calendar"
            accessibilityLabel={`다가오는 일정을 찾고 있어요. ${
              SCAN_MESSAGES[Math.min(scanStage, SCAN_MESSAGES.length - 1)]
            }`}
          />
          <Text style={styles.title}>가져올 일정을{'\n'}찾고 있어요</Text>
          <Text style={styles.subtitle}>{scanStatusMessage}</Text>
          <View style={styles.scanList}>
            {SCAN_MESSAGES.map((message, index) => (
              <View key={message} style={styles.scanRow}>
                <Ionicons
                  name={
                    scanStage > index
                      ? 'checkmark-circle'
                      : scanStage === index
                      ? 'time-outline'
                      : 'ellipse-outline'
                  }
                  size={19}
                  color={scanStage >= index ? BRAND_BLUE : colors.textDisabled}
                />
                <Text
                  style={[
                    styles.scanText,
                    {
                      color:
                        scanStage >= index
                          ? colors.textPrimary
                          : colors.textSecondary,
                    },
                  ]}
                >
                  {message}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </>
  );
}
