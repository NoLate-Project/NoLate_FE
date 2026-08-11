import React from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StatusBar,
  Text,
  View,
} from "react-native";

import PlainScheduleDetailView, {
  PLAIN_SCHEDULE_DETAIL_CONTENT_GAP,
} from "../../modules/schedule/components/detail/PlainScheduleDetailView";
import ScheduleArrivalObservationAction from "../../modules/schedule/components/detail/ScheduleArrivalObservationAction";
import TmapMapView from "../../modules/map/TmapMapView";
import { travelPlanStatusLabel } from "../../modules/schedule/travelPlanPresentation";
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from "./ScheduleDetailChrome";
import { createScheduleDetailStyles } from "./schedule-detail.styles";
import type { ScheduleDetailPresentation } from "./scheduleDetailPresentationModel";

type ScheduleDetailBackgroundProps = {
  presentation: ScheduleDetailPresentation;
  renderTravelPlanRows: () => React.ReactNode;
};

/** 지도·일반 일정 배경과 현재 위치·메모 플로팅 동작을 표시한다. */
export function ScheduleDetailBackground({
  presentation,
  renderTravelPlanRows,
}: ScheduleDetailBackgroundProps) {
  const {
    camera,
    colors,
    currentLocationPending,
    displayMarkers,
    displayPathOverlays,
    handleMapMarkerPress,
    handleMapZoomChanged,
    insets,
    isDark,
    isPlainSchedule,
    item,
    mapRef,
    mapZoom,
    mode,
    moveToCurrentLocation,
    notesText,
    openCurrentRoutePlanner,
    participantDisclosureAnimatedStyle,
    participantsExpanded,
    plainHeaderHeight,
    primaryText,
    routeOption,
    routeSavePending,
    scheduleRangeLabel,
    secondaryText,
    setMemoSheetVisible,
    sheetBorder,
    sheetMinHeight,
    shouldRenderMap,
    showTopRouteBar,
    toggleParticipantsExpanded,
    topCardAccentText,
    travelPlanParticipants,
  } = presentation;

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {shouldRenderMap ? (
        <TmapMapView
          ref={mapRef}
          errorOverlayTop={Math.max(insets.top + 188, 236)}
          camera={camera}
          markers={displayMarkers}
          pathOverlays={displayPathOverlays}
          pathOverlayZoom={mapZoom}
          clearRouteOverlays={displayPathOverlays.length === 0}
          routeOverlayScope={`schedule-detail-${item.id}-${
            routeOption?.id ?? 'route'
          }`}
          routeFocusMode
          nightModeEnabled={mode === 'dark'}
          showLocationButton={false}
          showZoomControls={false}
          onMarkerPress={handleMapMarkerPress}
          onZoomChanged={handleMapZoomChanged}
          fallbackBackgroundColor={colors.surface2}
          fallbackTextColor={colors.textSecondary}
          style={styles.fullMap}
        />
      ) : isPlainSchedule ? (
        <PlainScheduleDetailView
          item={item}
          contentTopInset={
            plainHeaderHeight + PLAIN_SCHEDULE_DETAIL_CONTENT_GAP
          }
          contentBottomInset={Math.max(insets.bottom + 32, 48)}
          travelPlan={
            item.routeSetupRequired === true ||
            travelPlanParticipants.length > 1
              ? {
                  statusLabel: travelPlanStatusLabel(
                    item.travelPlanStatus ?? 'NOT_CONFIGURED',
                  ),
                  actionLabel:
                    item.travelPlanStatus === 'READY' ? '수정' : '설정',
                  pending: routeSavePending,
                  onPress: openCurrentRoutePlanner,
                  participantContent:
                    travelPlanParticipants.length > 1 ? (
                      <View
                        style={[
                          styles.plainTravelPlanParticipants,
                          { borderTopColor: sheetBorder },
                        ]}
                      >
                        <Pressable
                          onPress={toggleParticipantsExpanded}
                          accessibilityRole="button"
                          accessibilityState={{
                            expanded: participantsExpanded,
                          }}
                          accessibilityLabel={`참여자 이동 계획 ${
                            travelPlanParticipants.length
                          }명 ${participantsExpanded ? '접기' : '보기'}`}
                          style={({ pressed }) => [
                            styles.plainTravelPlanDisclosure,
                            { opacity: pressed ? 0.58 : 1 },
                          ]}
                        >
                          <View style={styles.plainTravelPlanDisclosureTitle}>
                            <Ionicons
                              name="people-outline"
                              size={16}
                              color={secondaryText}
                            />
                            <Text
                              style={[
                                styles.plainTravelPlanDisclosureText,
                                { color: primaryText },
                              ]}
                            >
                              참여자 이동 계획
                            </Text>
                          </View>
                          <View style={styles.plainTravelPlanDisclosureMeta}>
                            <Text
                              style={[
                                styles.plainTravelPlanCount,
                                { color: secondaryText },
                              ]}
                            >
                              {travelPlanParticipants.length}명
                            </Text>
                            <Animated.View
                              style={participantDisclosureAnimatedStyle}
                            >
                              <Ionicons
                                name="chevron-down"
                                size={15}
                                color={secondaryText}
                              />
                            </Animated.View>
                          </View>
                        </Pressable>
                        {participantsExpanded ? renderTravelPlanRows() : null}
                      </View>
                    ) : undefined,
                }
              : undefined
          }
          arrivalObservation={
            item.myDepartedAt ? (
              <ScheduleArrivalObservationAction
                scheduleId={item.id}
                myDepartedAt={item.myDepartedAt}
              />
            ) : undefined
          }
        />
      ) : (
        <View
          style={[
            styles.scheduleOnlySurface,
            {
              backgroundColor: colors.surface2,
              paddingTop: insets.top + (showTopRouteBar ? 122 : 76),
              paddingBottom: sheetMinHeight + 28,
            },
          ]}
        >
          <View
            style={[
              styles.scheduleOnlyCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.scheduleOnlyHeader}>
              <View style={styles.scheduleOnlyIcon}>
                <Ionicons
                  name="calendar-clear-outline"
                  size={20}
                  color={topCardAccentText}
                />
              </View>
              <View style={styles.scheduleOnlyCopy}>
                <Text style={[styles.scheduleOnlyDate, { color: primaryText }]}>
                  {scheduleRangeLabel}
                </Text>
                <View style={styles.scheduleOnlyCategoryRow}>
                  <View
                    style={[
                      styles.scheduleOnlyCategoryDot,
                      { backgroundColor: item.category.color },
                    ]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.scheduleOnlyCategoryText,
                      { color: secondaryText },
                    ]}
                  >
                    {item.category.title}
                  </Text>
                </View>
              </View>
            </View>
            {notesText ? (
              <Text
                numberOfLines={4}
                style={[
                  styles.scheduleOnlyNotes,
                  { color: secondaryText, borderTopColor: colors.border },
                ]}
              >
                {notesText}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {shouldRenderMap ? (
        <Pressable
          onPress={moveToCurrentLocation}
          disabled={currentLocationPending}
          accessibilityRole="button"
          accessibilityLabel="지도에서 내 현재 위치 보기"
          accessibilityState={{
            busy: currentLocationPending,
            disabled: currentLocationPending,
          }}
          style={({ pressed }) => [
            styles.currentLocationButton,
            {
              bottom: sheetMinHeight + 16,
              backgroundColor: isDark ? '#20242C' : '#FFFFFF',
              borderColor: isDark
                ? 'rgba(255,255,255,0.16)'
                : 'rgba(15,23,42,0.12)',
              opacity: pressed || currentLocationPending ? 0.72 : 1,
            },
          ]}
        >
          {currentLocationPending ? (
            <ActivityIndicator size="small" color={topCardAccentText} />
          ) : (
            <Ionicons name="locate" size={19} color={topCardAccentText} />
          )}
          <Text
            style={[styles.currentLocationButtonText, { color: primaryText }]}
          >
            내 위치
          </Text>
        </Pressable>
      ) : null}

      {!isPlainSchedule && notesText ? (
        <Pressable
          testID="schedule-memo-trigger"
          onPress={() => setMemoSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="일정 메모 보기"
          accessibilityHint="메모 시트를 아래에서 엽니다"
          style={({ pressed }) => [
            styles.memoButton,
            {
              bottom: sheetMinHeight + 16,
              backgroundColor: isDark ? '#20242C' : '#FFFFFF',
              borderColor: isDark
                ? 'rgba(255,255,255,0.16)'
                : 'rgba(15,23,42,0.12)',
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Ionicons
            name="document-text-outline"
            size={18}
            color={topCardAccentText}
          />
          <Text style={[styles.memoButtonText, { color: primaryText }]}>
            메모
          </Text>
          <Ionicons name="chevron-up" size={14} color={secondaryText} />
        </Pressable>
      ) : null}


    </>
  );
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
