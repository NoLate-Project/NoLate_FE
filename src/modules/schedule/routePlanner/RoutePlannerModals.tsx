import React from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import BrandedLoader from '../../../ui/BrandedLoader';
import styles, { ORIGIN_COLOR } from './styles';
import type { RoutePlannerController } from './useRoutePlannerController';

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
  return (
    <ExpoIonicons
      {...props}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

type Props = { controller: RoutePlannerController };

/** 출발 시각 선택기와 현재 위치 사용 확인 모달을 렌더링합니다. */
export function RoutePlannerModals({ controller }: Props) {
  const {
    colors,
    isDark,
    reduceMotion,
    locationPromptTarget,
    locationPromptLoading,
    draftTransitDepartureAt,
    setDraftTransitDepartureAt,
    isTransitDeparturePickerOpen,
    setIsTransitDeparturePickerOpen,
    detailPanelBg,
    detailPrimaryText,
    detailSecondaryText,
    detailBorderColor,
    closeLocationPrompt,
    confirmLocationPrompt,
    applyTransitDepartureTime,
  } = controller;
  const modalAnimation = reduceMotion ? 'none' : 'fade';
  const locationTarget = locationPromptTarget === 'origin' ? '출발지' : '도착지';
  return (
    <>
      {Platform.OS === 'ios' ? (
        <Modal
          visible={isTransitDeparturePickerOpen}
          transparent
          animationType={modalAnimation}
          statusBarTranslucent
          onRequestClose={() => setIsTransitDeparturePickerOpen(false)}
          accessibilityViewIsModal
        >
          <View style={styles.transitDeparturePickerModal}>
            <Pressable
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.transitDeparturePickerBackdrop}
              onPress={() => setIsTransitDeparturePickerOpen(false)}
            />
            <View
              style={[
                styles.transitDeparturePickerSheet,
                { backgroundColor: detailPanelBg },
              ]}
            >
              <View style={styles.transitDeparturePickerHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="출발 시각 선택 취소"
                  onPress={() => setIsTransitDeparturePickerOpen(false)}
                  style={styles.transitDeparturePickerCommand}
                >
                  <Text
                    style={[
                      styles.transitDeparturePickerCommandText,
                      { color: detailSecondaryText },
                    ]}
                  >
                    취소
                  </Text>
                </Pressable>
                <View style={styles.transitDeparturePickerTitleRow}>
                  <Ionicons
                    name="time-outline"
                    size={18}
                    color={detailPrimaryText}
                  />
                  <Text
                    style={[
                      styles.transitDeparturePickerTitle,
                      { color: detailPrimaryText },
                    ]}
                  >
                    출발 시각
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="출발 시각 적용"
                  onPress={applyTransitDepartureTime}
                  style={[
                    styles.transitDeparturePickerCommand,
                    styles.transitDeparturePickerApply,
                  ]}
                >
                  <Text style={styles.transitDeparturePickerApplyText}>
                    적용
                  </Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={draftTransitDepartureAt}
                mode="datetime"
                display="spinner"
                locale="ko-KR"
                minuteInterval={5}
                minimumDate={new Date(Date.now() - 60_000)}
                themeVariant={isDark ? 'dark' : 'light'}
                onChange={(_event, value) => {
                  if (value) setDraftTransitDepartureAt(value);
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="현재 시각으로 설정"
                onPress={() => setDraftTransitDepartureAt(new Date())}
                style={[
                  styles.transitDepartureNowButton,
                  { borderColor: detailBorderColor },
                ]}
              >
                <Ionicons name="refresh-outline" size={16} color={detailPrimaryText} />
                <Text
                  style={[
                    styles.transitDepartureNowText,
                    { color: detailPrimaryText },
                  ]}
                >
                  현재 시각
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
      {locationPromptTarget && (
        <Modal
          visible
          transparent
          animationType={modalAnimation}
          statusBarTranslucent
          onRequestClose={closeLocationPrompt}
        >
          <View
            accessibilityViewIsModal
            style={styles.permissionOverlay}
            pointerEvents="box-none"
          >
            <Pressable
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              disabled={locationPromptLoading}
              style={styles.permissionBackdrop}
              onPress={closeLocationPrompt}
            />
            <View
              style={[styles.permissionPrompt, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.permissionIconWrap}>
                <Ionicons
                  name="navigate-outline"
                  size={28}
                  color={ORIGIN_COLOR}
                />
              </View>
              <Text
                accessibilityRole="header"
                style={[styles.permissionTitle, { color: colors.textPrimary }]}
              >
                현재 위치를 {locationTarget}로 사용할까요?
              </Text>
              <Text
                style={[styles.permissionBody, { color: colors.textSecondary }]}
              >
                위치 접근을 허용하면 {locationTarget}에 현재 위치를 채워요.
              </Text>
              <View style={styles.permissionActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="나중에"
                  onPress={closeLocationPrompt}
                  disabled={locationPromptLoading}
                  accessibilityState={{ disabled: locationPromptLoading }}
                  style={({ pressed }) => [
                    styles.permissionSecondaryButton,
                    {
                      borderColor: colors.border,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.permissionSecondaryText,
                      { color: colors.textPrimary },
                    ]}
                  >
                    나중에
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="계속"
                  accessibilityHint="기기의 위치 권한 안내를 엽니다"
                  onPress={confirmLocationPrompt}
                  disabled={locationPromptLoading}
                  accessibilityState={{
                    busy: locationPromptLoading,
                    disabled: locationPromptLoading,
                  }}
                  style={({ pressed }) => [
                    styles.permissionPrimaryButton,
                    {
                      backgroundColor: 'rgba(33,184,90,0.20)',
                      borderColor: 'rgba(33,184,90,0.52)',
                      opacity: pressed || locationPromptLoading ? 0.78 : 1,
                    },
                  ]}
                >
                  {locationPromptLoading ? (
                    <BrandedLoader
                      size="button"
                      variant="route"
                      accessibilityLabel="위치 권한을 확인하고 있어요"
                    />
                  ) : (
                    <Text style={[styles.permissionPrimaryText, { color: isDark ? '#7DE2A6' : '#176534' }]}>
                      계속
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}
