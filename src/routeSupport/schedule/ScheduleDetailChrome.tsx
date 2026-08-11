import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import React from "react";
import {
  Alert,
  LayoutAnimation,
  Linking,
  Platform,
  View,
} from "react-native";

import { getTransitRouteSummaryAccessibilityLabel } from "../../modules/schedule/components/route/TransitRouteSummaryRow";
import type { TransitRouteProgressSegment } from "../../modules/schedule/transitRouteProgress";
import { createScheduleDetailStyles } from "./schedule-detail.styles";

/** 일정 상세의 장식 아이콘에 공통 접근성 제외 속성을 적용해 중복 낭독을 방지한다. */
export function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
  return (
    <ExpoIonicons
      {...props}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

/** 날짜와 시각의 숫자를 두 자리 문자열로 맞춰 직렬화 형식을 일정하게 유지한다. */
export const pad2 = (n: number) => String(n).padStart(2, '0');
/** 로컬 Date 값을 일정 비교에 사용하는 YYYY-MM-DD 문자열로 변환한다. */
export const ymdText = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** 로컬 Date 값을 상세 화면에 표시할 HH:mm 문자열로 변환한다. */
export const hhmmText = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export const DEFAULT_CAMERA = { latitude: 37.5665, longitude: 126.978, zoom: 12 };
/** 시트 위치와 애니메이션 계산값을 지정한 최솟값·최댓값 범위로 제한한다. */
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export const SHEET_SNAP_VELOCITY_PROJECTION = 140;
export const MINUTE_MS = 60 * 1000;
export const SECOND_MS = 1000;
export const DEPARTURE_COUNTDOWN_REFRESH_MS = SECOND_MS;
export const APP_ACCENT_BLUE = '#2979FF';
export const SHEET_HANDLE_HEIGHT = 32;
export const IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT = 196;

/** 참여자 목록이 펼쳐지거나 접힐 때 높이와 투명도 변경을 같은 레이아웃 애니메이션으로 묶는다. */
export function configureParticipantDisclosureAnimation(expanded: boolean) {
  LayoutAnimation.configureNext({
    duration: expanded ? 200 : 170,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: {
      type: LayoutAnimation.Types.easeInEaseOut,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}
/** 저장된 대중교통 구간을 간결한 색상 막대로 표시하고 전체 경로를 설명하는 접근성 라벨을 제공한다. */
export function CompactRouteProgressStrip({
  segments,
  isDark,
}: {
  segments: TransitRouteProgressSegment[];
  isDark: boolean;
}) {
  if (segments.length === 0) return null;

  const neutralColor = isDark ? '#7A8491' : '#A5AFBC';

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={getTransitRouteSummaryAccessibilityLabel(segments)}
      style={styles.compactRouteStrip}
    >
      {segments.map((segment, index) => (
        <View
          key={`compact-strip-${segment.key}`}
          style={[
            styles.compactRouteStripSegment,
            index > 0 && styles.compactRouteStripSpacing,
            {
              flex: segment.flex,
              backgroundColor: segment.isRide ? segment.color : neutralColor,
            },
          ]}
        />
      ))}
    </View>
  );
}

/** 플랫폼에 맞는 앱 또는 위치 서비스 설정을 열고 실패하면 사용자가 직접 확인할 위치를 안내한다. */
export async function openDeviceLocationSettings(preferServiceSettings = false) {
  try {
    if (preferServiceSettings && Platform.OS === 'android') {
      await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      return;
    }
    await Linking.openSettings();
  } catch {
    Alert.alert(
      '설정을 열 수 없어요',
      '기기 설정에서 NoLate의 위치 권한을 확인해 주세요.',
    );
  }
}

/** 현재 위치 기능을 복구할 수 있도록 취소와 설정 이동 동작을 포함한 표준 안내창을 표시한다. */
export function showLocationSettingsAlert(
  title: string,
  message: string,
  preferServiceSettings = false,
) {
  Alert.alert(title, message, [
    { text: '취소', style: 'cancel' },
    {
      text: '설정 열기',
      onPress: () => {
        openDeviceLocationSettings(preferServiceSettings).catch(
          () => undefined,
        );
      },
    },
  ]);
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
