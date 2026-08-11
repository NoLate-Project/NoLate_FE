import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RouteDetailDesignVariant } from './RouteDetailDesignPreview.types';
import {
  LINE_2,
  LINE_4,
  type PreviewPalette,
} from './routeDetailPreviewPalette';
import styles from './RouteDetailDesignPreview.styles';

/** 경로 상세 미리보기의 지도 배경, 헤더, 지도 조작 버튼을 담당합니다. */
function MapRoad({
  left,
  top,
  width,
  rotate,
  palette,
  major = false,
}: {
  left: number | `${number}%`;
  top: number | `${number}%`;
  width: number | `${number}%`;
  rotate: string;
  palette: PreviewPalette;
  major?: boolean;
}) {
  return (
    <View
      style={[
        styles.mapRoadEdge,
        major ? styles.mapRoadEdgeMajor : styles.mapRoadEdgeMinor,
        {
          left,
          top,
          width,
          backgroundColor: palette.mapRoadEdge,
          transform: [{ rotate }],
        },
      ]}
    >
      <View
        style={[
          styles.mapRoad,
          major ? styles.mapRoadMajor : styles.mapRoadMinor,
          {
            backgroundColor: palette.mapRoad,
          },
        ]}
      />
    </View>
  );
}

/** 미리보기 지도 위에 이동 구간별 색상과 점선을 적용한 경로 선을 렌더링합니다. */
function RouteLine({
  left,
  top,
  width,
  rotate,
  color,
}: {
  left: number;
  top: number;
  width: number;
  rotate: string;
  color: string;
}) {
  return (
    <View
      style={[
        styles.mapRouteLine,
        { left, top, width, backgroundColor: color, transform: [{ rotate }] },
      ]}
    />
  );
}

/** 출발지·도착지의 의미 색상과 레이블을 사용하는 지도 핀을 렌더링합니다. */
function MapPin({
  left,
  top,
  label,
  destination = false,
  palette,
}: {
  left: number;
  top: number;
  label: string;
  destination?: boolean;
  palette: PreviewPalette;
}) {
  return (
    <View style={[styles.mapPinWrap, { left, top }]}>
      <View
        style={[
          styles.mapPinLabel,
          {
            backgroundColor: palette.sheet,
            borderColor: palette.border,
          },
        ]}
      >
        <Text style={[styles.mapPinLabelText, { color: palette.text }]}>
          {label}
        </Text>
      </View>
      <View
        style={[
          styles.mapPin,
          {
            backgroundColor: destination ? palette.blue : palette.text,
            borderColor: palette.sheet,
          },
        ]}
      >
        <Ionicons
          name={destination ? 'flag' : 'ellipse'}
          size={destination ? 11 : 7}
          color={palette.sheet}
        />
      </View>
    </View>
  );
}

/** 경로 선, 정류장, 출발·도착 핀을 조합해 상세 미리보기 지도를 구성합니다. */
export function RouteMap({
  palette,
  selectedLeg,
}: {
  palette: PreviewPalette;
  selectedLeg: string | null;
}) {
  return (
    <View
      style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.map }]}
    >
      <View
        style={[styles.mapPark, { backgroundColor: `${palette.green}18` }]}
      />
      <MapRoad
        left="-12%"
        top="21%"
        width="132%"
        rotate="12deg"
        palette={palette}
        major
      />
      <MapRoad
        left="-18%"
        top="44%"
        width="142%"
        rotate="-8deg"
        palette={palette}
        major
      />
      <MapRoad
        left="10%"
        top="67%"
        width="108%"
        rotate="18deg"
        palette={palette}
        major
      />
      <MapRoad
        left="9%"
        top="13%"
        width="92%"
        rotate="72deg"
        palette={palette}
      />
      <MapRoad
        left="43%"
        top="8%"
        width="82%"
        rotate="86deg"
        palette={palette}
      />
      <MapRoad
        left="-2%"
        top="62%"
        width="85%"
        rotate="-66deg"
        palette={palette}
      />
      <MapRoad
        left="56%"
        top="56%"
        width="74%"
        rotate="-52deg"
        palette={palette}
      />
      <Text
        style={[
          styles.mapDistrict,
          styles.mapDistrictYongsan,
          { color: palette.tertiary },
        ]}
      >
        용산구
      </Text>
      <Text
        style={[
          styles.mapDistrict,
          styles.mapDistrictSeocho,
          { color: palette.tertiary },
        ]}
      >
        서초구
      </Text>
      <Text
        style={[
          styles.mapDistrict,
          styles.mapDistrictGangnam,
          { color: palette.tertiary },
        ]}
      >
        강남구
      </Text>

      <RouteLine left={70} top={201} width={91} rotate="18deg" color={LINE_4} />
      <RouteLine
        left={148}
        top={220}
        width={106}
        rotate="46deg"
        color={LINE_4}
      />
      <RouteLine
        left={225}
        top={285}
        width={97}
        rotate="18deg"
        color={LINE_2}
      />
      <RouteLine
        left={304}
        top={303}
        width={62}
        rotate="-28deg"
        color={LINE_2}
      />

      {selectedLeg ? (
        <View
          style={[
            styles.selectedMapLeg,
            { backgroundColor: palette.sheet, borderColor: palette.border },
          ]}
        >
          <View
            style={[
              styles.selectedMapLegDot,
              { backgroundColor: selectedLeg === '4호선' ? LINE_4 : LINE_2 },
            ]}
          />
          <Text style={[styles.selectedMapLegText, { color: palette.text }]}>
            {selectedLeg} 구간
          </Text>
        </View>
      ) : null}

      <MapPin left={55} top={173} label="서울역" palette={palette} />
      <MapPin
        left={326}
        top={278}
        label="강남역"
        destination
        palette={palette}
      />
    </View>
  );
}

/** 경로 상세 헤더의 아이콘 버튼을 접근성 정보와 누름 피드백을 포함해 렌더링합니다. */
function HeaderIcon({
  icon,
  label,
  color,
  pressedColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  pressedColor: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => undefined}
      style={({ pressed }) => [
        styles.headerIconButton,
        pressed && { backgroundColor: pressedColor },
      ]}
    >
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

/** 경로 상세 미리보기의 뒤로가기, 제목, 보조 액션을 공통 헤더로 구성합니다. */
export function PreviewHeader({
  variant,
  palette,
  topInset,
}: {
  variant: RouteDetailDesignVariant;
  palette: PreviewPalette;
  topInset: number;
}) {
  const improved = variant === 'improved';

  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: topInset,
          height: topInset + (improved ? 56 : 112),
          backgroundColor: palette.sheet,
          borderBottomColor: palette.border,
        },
      ]}
    >
      <View style={styles.headerMainRow}>
        <HeaderIcon
          icon="chevron-back"
          label="이전 화면으로 돌아가기"
          color={palette.text}
          pressedColor={palette.sheetMuted}
        />
        <View style={styles.headerTitleArea}>
          {improved ? (
            <View style={styles.headerCategoryRow}>
              <View
                style={[styles.categoryDot, { backgroundColor: palette.blue }]}
              />
              <Text
                style={[styles.headerCategory, { color: palette.secondary }]}
              >
                개인
              </Text>
            </View>
          ) : (
            <View style={styles.currentKindRow}>
              <Ionicons
                name="calendar-clear-outline"
                size={12}
                color={palette.blue}
              />
              <Text style={[styles.currentKindText, { color: palette.blue }]}>
                일정
              </Text>
            </View>
          )}
          <Text
            numberOfLines={1}
            style={[
              improved ? styles.improvedHeaderTitle : styles.currentHeaderTitle,
              { color: palette.text },
            ]}
          >
            강남역에서 점심 약속
          </Text>
        </View>
        <View style={styles.headerActionRow}>
          <HeaderIcon
            icon="share-social-outline"
            label="일정 공유"
            color={palette.text}
            pressedColor={palette.sheetMuted}
          />
          <HeaderIcon
            icon="pencil-outline"
            label="일정 수정"
            color={improved ? palette.blue : palette.text}
            pressedColor={palette.sheetMuted}
          />
        </View>
      </View>

      {!improved ? (
        <View
          style={[styles.currentRouteBar, { borderTopColor: palette.border }]}
        >
          <Ionicons name="navigate-outline" size={14} color={palette.blue} />
          <Text
            style={[styles.currentRouteBarText, { color: palette.text }]}
            numberOfLines={1}
          >
            서울역 → 강남역
          </Text>
          <Text style={[styles.routeMetaText, { color: palette.secondary }]}>
            대중교통 · 36분
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** 지도 확대·축소 및 현재 위치 같은 미리보기 제어 버튼 묶음을 렌더링합니다. */
export function MapControls({
  variant,
  palette,
  sheetHeight,
  onShowAll,
}: {
  variant: RouteDetailDesignVariant;
  palette: PreviewPalette;
  sheetHeight: number;
  onShowAll: () => void;
}) {
  const improved = variant === 'improved';

  return (
    <>
      {!improved ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="일정 메모 보기"
          onPress={() => undefined}
          style={[
            styles.currentMemoButton,
            {
              bottom: sheetHeight + 12,
              backgroundColor: palette.sheet,
              borderColor: palette.border,
            },
          ]}
        >
          <Ionicons
            name="document-text-outline"
            size={16}
            color={palette.blue}
          />
          <Text style={[styles.mapPillText, { color: palette.text }]}>
            메모
          </Text>
          <Ionicons name="chevron-up" size={12} color={palette.secondary} />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="지도에서 내 현재 위치 보기"
        onPress={onShowAll}
        style={[
          improved ? styles.improvedMapButton : styles.currentLocationButton,
          {
            bottom: sheetHeight + 12,
            backgroundColor: palette.sheet,
            borderColor: palette.border,
          },
        ]}
      >
        <Ionicons name="locate" size={18} color={palette.blue} />
        {!improved ? (
          <Text style={[styles.mapPillText, { color: palette.text }]}>
            내 위치
          </Text>
        ) : null}
      </Pressable>
    </>
  );
}
