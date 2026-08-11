import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, LayoutAnimation, View } from 'react-native';

import type { TransitArrivalInfo } from '../../../../api/transitArrivals';
import {
  formatRouteDistance,
  type RouteInfo,
  type RouteStep,
  type RouteStepType,
} from '../../routeInfo';
import { getBusArrivalStationIdentifiers } from '../../transitArrivalIdentifiers';
import styles from './RouteStepTimeline.styles';

/** 경로 단계의 제목·아이콘·실시간 도착정보 표시 규칙과 작은 UI 조각을 모읍니다. */
export function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
  return (
    <ExpoIonicons
      {...props}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

const DISCLOSURE_OPEN_DURATION = 200;
const DISCLOSURE_CLOSE_DURATION = 170;

/** 경로 단계 펼침·접힘에 맞는 LayoutAnimation을 설정해 높이와 투명도 전환을 동기화합니다. */
export function configureRouteStepDisclosureAnimation(expanded: boolean) {
  LayoutAnimation.configureNext({
    duration: expanded ? DISCLOSURE_OPEN_DURATION : DISCLOSURE_CLOSE_DURATION,
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

/** 경로 단계의 펼침 상태에 따라 회전하는 화살표를 렌더링합니다. */
export function DisclosureChevron({
  expanded,
  size,
  color,
}: {
  expanded: boolean;
  size: number;
  color: string;
}) {
  const progress = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: expanded ? DISCLOSURE_OPEN_DURATION : DISCLOSURE_CLOSE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, progress]);

  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <Animated.View pointerEvents="none" style={{ transform: [{ rotate }] }}>
      <Ionicons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}

export type RouteStepTimelineProps = {
  routeInfo: RouteInfo;
  selectedStepId?: string;
  selectedPassStop?: {
    stepId: string;
    stopIndex: number;
  };
  onStepPress?: (step: RouteStep) => void;
  allowEndpointPress?: boolean;
  forceDark?: boolean;
  primaryTextColor?: string;
  secondaryTextColor?: string;
  initialExpandedStepId?: string;
  compact?: boolean;
  realtimeArrivalsEnabled?: boolean;
};

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type ArrivalRequest =
  | {
      kind: 'SUBWAY';
      stationName: string;
      lineName?: string;
      directionName?: string;
      directionCode?: 'UP' | 'DOWN';
    }
  | {
      kind: 'BUS';
      arsId?: string;
      cityCode?: string;
      nodeId?: string;
      stationName?: string;
      routeName?: string;
    };

/** 경로 단계 종류와 환승 여부에 맞는 Ionicons 이름을 선택합니다. */
function getStepIcon(type: RouteStepType): IoniconName {
  if (type === 'DESTINATION') return 'location';
  if (type === 'WALK') return 'walk-outline';
  if (type === 'SUBWAY') return 'train-outline';
  if (type === 'BUS') return 'bus-outline';
  if (type === 'DRIVE') return 'car-outline';
  if (type === 'BIKE') return 'bicycle-outline';
  return 'swap-horizontal';
}

/** 경로 단계 아이콘 종류에 맞는 시각적 크기를 반환합니다. */
function getStepIconSize(type: RouteStepType, compact: boolean): number {
  if (type === 'DESTINATION') return compact ? 20 : 20;
  if (type === 'WALK') return compact ? 19 : 19;
  return compact ? 20 : 18;
}

/** 경로 단계의 이동 수단 아이콘을 색상·크기 정책에 맞춰 렌더링합니다. */
export function StepIconGlyph({
  type,
  color,
  compact,
}: {
  type: RouteStepType;
  color: string;
  compact: boolean;
}) {
  if (type === 'ORIGIN') {
    return (
      <View
        style={[
          styles.originGlyphOuter,
          compact && styles.originGlyphOuterCompact,
          { borderColor: color },
        ]}
      >
        <View
          style={[
            styles.originGlyphCore,
            compact && styles.originGlyphCoreCompact,
            { backgroundColor: color },
          ]}
        />
      </View>
    );
  }

  return (
    <Ionicons
      name={getStepIcon(type)}
      size={getStepIconSize(type, compact)}
      color={color}
    />
  );
}

/** 경로 단계의 노선, 승하차 지점, 이동 설명을 조합해 대표 제목을 만듭니다. */
export function buildStepTitle(step: RouteStep): string {
  if (step.type !== 'WALK') {
    const badge = step.badgeText ?? step.lineName;
    const withoutBadge =
      badge && step.title.startsWith(`${badge} `)
        ? step.title.slice(badge.length + 1)
        : step.title;
    return (
      withoutBadge
        .replace(/\s*승차\s*→.*$/u, '')
        .replace(/\s*하차\s*$/u, '')
        .replace(/\s*승차\s*$/u, '')
        .trim() || withoutBadge
    );
  }
  if (step.title.trim() !== '도보') return step.title;
  const distance = formatRouteDistance(step.distanceMeters);
  const duration =
    typeof step.durationMinutes === 'number'
      ? `${step.durationMinutes}분`
      : undefined;
  const summary = [distance, duration].filter(Boolean).join(' · ');
  return summary ? `도보 ${summary}` : step.title;
}

/** 제목과 중복되지 않는 유효한 단계 설명이 있을 때만 표시하도록 판별합니다. */
export function shouldShowDescription(step: RouteStep): boolean {
  if (!step.description) return false;
  if (step.type === 'WALK' && step.title.trim() === '도보') return false;
  return true;
}

/** 경로 지점의 이름·주소 중 사용자에게 보여 줄 값을 우선순위에 따라 선택합니다. */
export function getPointLabel(type: RouteStepType): string | undefined {
  if (type === 'ORIGIN') return '출발';
  if (type === 'DESTINATION') return '도착';
  return undefined;
}

/** 승차 단계의 탑승 위치·방면·정거장 정보를 안내 항목 목록으로 구성합니다. */
export function buildBoardingGuideItems(
  step: RouteStep,
): Array<{ key: string; icon: IoniconName; label: string }> {
  const items: Array<{ key: string; icon: IoniconName; label: string }> = [];
  if (step.boardingExit) {
    items.push({ key: 'exit', icon: 'exit-outline', label: step.boardingExit });
  }
  if (step.boardingPlatform) {
    items.push({
      key: 'platform',
      icon: 'business-outline',
      label: step.boardingPlatform,
    });
  }
  const transferPosition = step.recommendedTransferPosition?.trim();
  const boardingPosition = step.recommendedBoardingPosition?.trim();
  if (transferPosition) {
    items.push({
      key: 'transfer-position',
      icon: 'swap-horizontal-outline',
      label: `추천 승차칸 ${transferPosition} · 환승 최적 위치`,
    });
  } else if (boardingPosition) {
    items.push({
      key: 'boarding-position',
      icon: 'compass-outline',
      label: `추천 승차칸 ${boardingPosition}`,
    });
  }
  return items;
}

/** 버스·지하철 이동 단계의 정거장 수와 하차 정보를 한 줄 설명으로 만듭니다. */
export function buildRideDescription(step: RouteStep): string | undefined {
  if (step.description)
    return step.description
      .replace(/\s*승차\s*/gu, ' ')
      .replace(/\s*하차\s*/gu, ' ')
      .replace(/\s*→\s*/gu, ' · ')
      .replace(/\s+/g, ' ')
      .trim();
  const chunks = [
    typeof step.stationCount === 'number'
      ? `${step.stationCount}${step.type === 'BUS' ? '개 정류장' : '정거장'}`
      : undefined,
    typeof step.durationMinutes === 'number'
      ? `${step.durationMinutes}분`
      : undefined,
  ].filter(Boolean);
  return chunks.join(' · ') || step.description;
}

/** 도착 정보의 시각 문자열을 오전·오후가 포함된 짧은 한국어 형식으로 변환합니다. */
export function formatArrivalClock(
  baseValue: string,
  offsetMinutes: number,
): string {
  const base = new Date(baseValue);
  if (Number.isNaN(base.getTime())) return '--:--';
  const next = new Date(
    base.getTime() + Math.max(0, offsetMinutes) * 60 * 1000,
  );
  const hours = String(next.getHours()).padStart(2, '0');
  const minutes = String(next.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** 경로 단계에서 도착 정보 조회에 사용할 노선 식별 레이블을 추출합니다. */
function getTransitLineLabel(step: RouteStep): string | undefined {
  return step.badgeText ?? step.lineName;
}

/** 버스 도착 조회에 사용할 정류장 식별자 후보를 우선순위대로 선택합니다. */
function pickBusStationIdentifiers(
  step: RouteStep,
): Pick<
  Extract<ArrivalRequest, { kind: 'BUS' }>,
  'arsId' | 'cityCode' | 'nodeId' | 'stationName'
> {
  return getBusArrivalStationIdentifiers(step.passStops, buildStepTitle(step));
}

/** 경로 단계가 실시간 도착 조회를 지원할 때 API 요청 파라미터를 구성합니다. */
export function getArrivalRequest(step: RouteStep): ArrivalRequest | undefined {
  if (step.type === 'SUBWAY') {
    const stationName = buildStepTitle(step).replace(/\s+/g, ' ').trim();
    if (!stationName) return undefined;
    return {
      kind: 'SUBWAY',
      stationName,
      lineName: getTransitLineLabel(step),
      directionName: step.directionName,
      directionCode: step.directionCode,
    };
  }

  if (step.type === 'BUS') {
    const identifiers = pickBusStationIdentifiers(step);
    if (!identifiers.arsId && !identifiers.nodeId && !identifiers.stationName)
      return undefined;
    return {
      kind: 'BUS',
      ...identifiers,
      routeName: getTransitLineLabel(step),
    };
  }

  return undefined;
}

/** 도착 정보 요청 파라미터를 안정적인 캐시·상태 조회 키로 직렬화합니다. */
export function buildArrivalLookupKey(steps: RouteStep[]): string {
  return steps
    .map(step => {
      const request = getArrivalRequest(step);
      if (!request) return `${step.id}:none`;
      if (request.kind === 'SUBWAY') {
        return `${step.id}:subway:${request.stationName}:${
          request.lineName ?? ''
        }:${request.directionName ?? ''}:${request.directionCode ?? ''}`;
      }
      return `${step.id}:bus:${request.arsId ?? ''}:${request.cityCode ?? ''}:${
        request.nodeId ?? ''
      }:${request.stationName ?? ''}:${request.routeName ?? ''}`;
    })
    .join('|');
}

/** 초 단위 값을 mm:ss 형식으로 변환해 도착 남은 시간을 표시합니다. */
function formatClockValue(value?: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** 도착 예정 초를 분·초 기반의 짧은 대기 문구로 변환합니다. */
export function getArrivalWaitText(arrival: TransitArrivalInfo): string {
  if (arrival.arrivalStatus === 'APPROACHING') return '곧';
  if (arrival.arrivalStatus === 'ARRIVED') return '도착';
  if (arrival.arrivalStatus === 'DEPARTED') return '출발';
  if (
    typeof arrival.waitMinutes === 'number' &&
    Number.isFinite(arrival.waitMinutes)
  ) {
    return arrival.waitMinutes <= 0 ? '곧' : `${arrival.waitMinutes}분`;
  }
  if (
    typeof arrival.waitSeconds === 'number' &&
    Number.isFinite(arrival.waitSeconds)
  ) {
    const minutes = Math.ceil(Math.max(0, arrival.waitSeconds) / 60);
    return minutes <= 0 ? '곧' : `${minutes}분`;
  }
  return arrival.arrivalMessage?.trim() || '도착 예정';
}

/** 도착 예정 시각을 현재 시각 기준의 읽기 쉬운 시계 문구로 변환합니다. */
export function getArrivalClockText(arrival: TransitArrivalInfo): string {
  const expectedClock = formatClockValue(arrival.expectedAt);
  if (expectedClock) return expectedClock;

  const waitMinutes =
    typeof arrival.waitMinutes === 'number'
      ? arrival.waitMinutes
      : typeof arrival.waitSeconds === 'number'
      ? Math.ceil(Math.max(0, arrival.waitSeconds) / 60)
      : undefined;

  if (typeof waitMinutes === 'number' && Number.isFinite(waitMinutes)) {
    return formatArrivalClock(new Date().toISOString(), waitMinutes);
  }
  return '--:--';
}

/** 도착 정보의 방면·종점 데이터를 중복 없이 조합한 안내 문구로 만듭니다. */
export function getArrivalDirectionText(
  arrival: TransitArrivalInfo,
  fallback?: string,
): string {
  const chunks: string[] = [];
  const destinationName = arrival.destinationName?.trim();
  if (destinationName) chunks.push(`${destinationName}행`);
  else if (arrival.direction?.trim()) chunks.push(arrival.direction.trim());

  if (
    typeof arrival.remainingStops === 'number' &&
    Number.isFinite(arrival.remainingStops)
  ) {
    chunks.push(
      arrival.remainingStops <= 0
        ? '정류장 진입'
        : `${arrival.remainingStops}정류장 전`,
    );
  }
  if (
    arrival.arrivalStatusLabel?.trim() &&
    (arrival.arrivalStatus === 'PREVIOUS_STOP' ||
      arrival.arrivalStatus === 'IN_TRANSIT')
  ) {
    chunks.push(arrival.arrivalStatusLabel.trim());
  }
  const vehicleType = arrival.vehicleType?.trim();
  const vehicleTypeAlreadyBadged =
    !!vehicleType &&
    ((arrival.lowFloor && vehicleType.includes('저상')) ||
      (arrival.express &&
        (vehicleType.includes('급행') || vehicleType.includes('특급'))));
  if (vehicleType && !vehicleTypeAlreadyBadged) chunks.push(vehicleType);

  if (chunks.length > 0) return Array.from(new Set(chunks)).join(' · ');
  return arrival.arrivalMessage?.trim() || fallback || '도착 예정';
}

/** 도착 정보 응답 목록에서 가장 최근 갱신 시각을 찾아 반환합니다. */
export function getArrivalUpdatedAt(
  arrivals: TransitArrivalInfo[],
  fallback: string,
): string {
  const timestamps = arrivals
    .flatMap(arrival => [arrival.sourceUpdatedAt, arrival.observedAt])
    .map(value => (value ? new Date(value).getTime() : Number.NaN))
    .filter(value => Number.isFinite(value));
  if (!timestamps.length) return fallback;
  return new Date(Math.max(...timestamps)).toISOString();
}
