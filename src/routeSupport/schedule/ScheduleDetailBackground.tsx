import React from "react";
import Reanimated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import {
  Animated,
  Keyboard,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import PlainScheduleDetailView, {
  PLAIN_SCHEDULE_DETAIL_CONTENT_GAP,
} from "../../modules/schedule/components/detail/PlainScheduleDetailView";
import ScheduleArrivalObservationAction from "../../modules/schedule/components/detail/ScheduleArrivalObservationAction";
import TmapMapView, { type TmapLoadState } from "../../modules/map/TmapMapView";
import LoadingIndicator from "../../ui/LoadingIndicator";
import { SavedJourneyRoutePreview } from '../../modules/journey/SavedJourneyRoutePreview';
import { buildSavedJourneyInput } from '../../modules/journey/savedJourneyGuidance';
import { travelPlanStatusLabel } from "../../modules/schedule/travelPlanPresentation";
import { getUserVisibleScheduleNotes } from "../../modules/schedule/calendarImportNotes";
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  MAP_ACTION_SHEET_GAP,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from "./ScheduleDetailChrome";
import { createScheduleDetailStyles } from "./schedule-detail.styles";
import {
  SCHEDULE_EDITOR_EXIT_MS,
  ScheduleDetailEditingContext,
  ScheduleDetailEditResultContext,
} from "./ScheduleDetailEditorTransition";
import type { ScheduleDetailPresentation } from "./scheduleDetailPresentationModel";

type ScheduleDetailBackgroundProps = {
  presentation: ScheduleDetailPresentation;
  renderTravelPlanRows: () => React.ReactNode;
  mapReady: boolean;
  mapRevision: number;
  onMapLoadStateChange: (state: TmapLoadState) => void;
};

const savedRouteMapEntrance = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const overviewButtonEntrance = FadeIn.duration(120).reduceMotion(ReduceMotion.System);

/** 지도·일반 일정 배경과 현재 위치·메모 플로팅 동작을 표시한다. */
export function ScheduleDetailBackground({
  presentation,
  renderTravelPlanRows,
  mapReady,
  mapRevision,
  onMapLoadStateChange,
}: ScheduleDetailBackgroundProps) {
  const { fontScale } = useWindowDimensions();
  const editing = React.useContext(ScheduleDetailEditingContext);
  const editResult = React.useContext(ScheduleDetailEditResultContext);
  const handledMemoEdit = React.useRef<typeof editResult>(null);
  const memoHighlight = React.useRef(new Animated.Value(0)).current;
  const {
    camera,
    colors,
    currentLocationPending,
    displayMarkers,
    displayPathOverlays,
    hasFocusedMapLocation,
    handleMapMarkerPress,
    handleMapCameraChanged,
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
    reduceMotion,
    routeOption,
    routeSavePending,
    routeSaveConfirmed,
    canRetryRouteSave,
    retryRouteSave,
    scheduleRangeLabel,
    secondaryText,
    setMemoSheetVisible,
    sheetBorder,
    sheetMinHeight,
    sheetMode,
    showWholeRoute,
    shouldRenderMap,
    showTopRouteBar,
    toggleParticipantsExpanded,
    topCardAccentText,
    travelPlanParticipants,
  } = presentation;
  const travelPlanStatus = item.travelPlanStatus ?? 'NOT_CONFIGURED';
  const needsFirstRoute = item.routeSetupRequired === true && travelPlanStatus === 'READY';
  const mapActionSurface = {
    backgroundColor: isDark ? '#20242C' : '#FFFFFF',
    borderColor: sheetBorder,
  };
  const mapActionFontSize = Math.round(12 * Math.min(fontScale, 1.65));
  const mapActionText = {
    color: primaryText,
    fontSize: mapActionFontSize,
    lineHeight: Math.ceil(mapActionFontSize * 1.35),
  };
  const showMemoHighlight = !isPlainSchedule && fontScale <= 1.35 && Boolean(notesText);
  React.useEffect(() => {
    if (editing || !showMemoHighlight || !editResult || editResult === handledMemoEdit.current ||
        editResult.updated.id !== item.id) return;
    const previousMemo = getUserVisibleScheduleNotes(editResult.previous.notes);
    const updatedMemo = getUserVisibleScheduleNotes(editResult.updated.notes);
    if (reduceMotion || !updatedMemo || previousMemo === updatedMemo) {
      handledMemoEdit.current = editResult;
      return;
    }
    let editorHidden = false;
    const highlightWhenVisible = () => {
      if (!editorHidden || Keyboard.isVisible() || handledMemoEdit.current === editResult) return;
      handledMemoEdit.current = editResult;
      memoHighlight.setValue(0.18);
      Animated.timing(memoHighlight, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
        isInteraction: false,
      }).start();
    };
    const keyboard = Keyboard.addListener("keyboardDidHide", highlightWhenVisible);
    const timer = setTimeout(() => {
      editorHidden = true;
      highlightWhenVisible();
    }, SCHEDULE_EDITOR_EXIT_MS);
    return () => {
      keyboard.remove();
      clearTimeout(timer);
      memoHighlight.stopAnimation();
      memoHighlight.setValue(0);
    };
  }, [editing, editResult, item.id, memoHighlight, reduceMotion, showMemoHighlight]);

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {presentation.offlineGuidancePreview && !presentation.inspectedTravelPlan ? (
        <SavedJourneyRoutePreview input={buildSavedJourneyInput(item.route, item.origin, item.destination)}
          walkingPaths={presentation.guidanceWalkingPaths}
          position={displayMarkers.find(marker => marker.id === 'schedule-detail-guidance-location') ?? null} />
      ) : shouldRenderMap ? (
        <Reanimated.View style={styles.fullMap} entering={routeSaveConfirmed ? savedRouteMapEntrance : undefined}>
          <TmapMapView
            ref={mapRef}
            key={mapRevision}
            onLoadStateChange={onMapLoadStateChange}
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
            onCameraChanged={handleMapCameraChanged}
            onZoomChanged={handleMapZoomChanged}
            fallbackBackgroundColor={colors.surface2}
            fallbackTextColor={colors.textSecondary}
            style={styles.fullMap}
          />
        </Reanimated.View>
      ) : isPlainSchedule ? (
        <PlainScheduleDetailView
          item={item}
          contentTopInset={
            plainHeaderHeight + PLAIN_SCHEDULE_DETAIL_CONTENT_GAP
          }
          contentBottomInset={Math.max(insets.bottom + 32, 48)}
          travelPlan={
            canRetryRouteSave || routeSavePending || routeSaveConfirmed || item.routeSetupRequired === true ||
            travelPlanParticipants.length > 1
              ? {
                  statusLabel: routeSavePending ? '경로를 적용하고 있어요'
                    : canRetryRouteSave ? '경로를 적용하지 못했어요'
                    : routeSaveConfirmed ? '경로를 적용했어요'
                    : travelPlanStatusLabel(needsFirstRoute ? 'NOT_CONFIGURED' : travelPlanStatus),
                  actionLabel:
                    canRetryRouteSave ? '다시 시도'
                      : travelPlanStatus === 'READY' && !needsFirstRoute ? '수정' : '설정',
                  pending: routeSavePending,
                  confirmed: routeSaveConfirmed && !routeSavePending && !canRetryRouteSave,
                  onPress: canRetryRouteSave ? retryRouteSave : openCurrentRoutePlanner,
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

      {mapReady ? (
        <View pointerEvents="box-none" style={[styles.mapActionStack, { bottom: sheetMinHeight + MAP_ACTION_SHEET_GAP }]}>
          {sheetMode === 'compact' && hasFocusedMapLocation && (
            <Pressable
              testID="schedule-route-map-overview"
              onPress={showWholeRoute}
              accessibilityRole="button"
              accessibilityLabel="지도에서 전체 경로 보기"
              style={({ pressed }) => [
                styles.mapActionButton,
                mapActionSurface,
                { opacity: pressed ? 0.72 : 1 },
              ]}
            >
              <Reanimated.View entering={overviewButtonEntrance} pointerEvents="none">
                <Ionicons name="map-outline" size={18} color={topCardAccentText} />
              </Reanimated.View>
              <Text allowFontScaling={false} style={[styles.mapActionButtonText, mapActionText]}>
                전체 경로
              </Text>
            </Pressable>
          )}
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
              styles.mapActionButton,
              mapActionSurface,
              { opacity: pressed || currentLocationPending ? 0.72 : 1 },
            ]}
          >
            {currentLocationPending ? (
              <LoadingIndicator size="inline" delayMs={150} />
            ) : (
              <Ionicons name="locate-outline" size={19} color={topCardAccentText} />
            )}
            <Text
              allowFontScaling={false}
              style={[styles.mapActionButtonText, mapActionText]}
            >
              내 위치
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!isPlainSchedule && notesText ? (
        <Pressable
          testID="schedule-memo-trigger"
          onPress={() => setMemoSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="일정 메모 보기"
          accessibilityHint="메모 시트를 아래에서 엽니다"
          style={({ pressed }) => [
            styles.mapActionButton,
            styles.memoButton,
            mapActionSurface,
            {
              bottom: sheetMinHeight + MAP_ACTION_SHEET_GAP,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          {showMemoHighlight && (
            <Animated.View
              testID="schedule-detail-edit-highlight-memo"
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[StyleSheet.absoluteFillObject, styles.memoHighlight, {
                backgroundColor: topCardAccentText,
                opacity: memoHighlight,
              }]}
            />
          )}
          <Ionicons
            name="document-text-outline"
            size={18}
            color={topCardAccentText}
          />
          <Text allowFontScaling={false} style={[styles.mapActionButtonText, mapActionText]}>
            메모
          </Text>
          <Ionicons name="chevron-up-outline" size={14} color={secondaryText} />
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
