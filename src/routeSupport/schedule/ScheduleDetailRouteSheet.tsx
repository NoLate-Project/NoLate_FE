import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import CalendarGlassSurface from '../../modules/schedule/components/calendar/CalendarGlassSurface';
import RouteStepTimeline from '../../modules/schedule/components/route/RouteStepTimeline';
import TransitRouteProgressBar from '../../modules/schedule/components/route/TransitRouteProgressBar';
import ScheduleArrivalObservationAction from '../../modules/schedule/components/detail/ScheduleArrivalObservationAction';
import { fromISO } from '../../../lib/util/data';
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  hhmmText,
  Ionicons,
} from './ScheduleDetailChrome';
import {
  travelModeLabel,
  travelPlanParticipantLabel,
} from './scheduleDetailModel';
import { createScheduleDetailStyles } from './schedule-detail.styles';
import type { ScheduleDetailPresentation } from './scheduleDetailPresentationModel';
import { ScheduleDetailRouteQuickSummary } from './ScheduleDetailRouteQuickSummary';

type ScheduleDetailRouteSheetProps = {
  presentation: ScheduleDetailPresentation;
  renderDepartureParticipantChips: (compact?: boolean) => React.ReactNode;
  renderTravelPlanRows: () => React.ReactNode;
};

/** 경로 요약과 펼친 상세 정보를 드래그 가능한 하단 시트로 표시한다. */
export function ScheduleDetailRouteSheet({
  presentation,
  renderDepartureParticipantChips,
  renderTravelPlanRows,
}: ScheduleDetailRouteSheetProps) {
  const {
    completeDeparture,
    departureActionPending,
    departureCompleted,
    departureCountLabel,
    departureParticipants,
    departureRemainingLabel,
    displayTravelMode,
    effectiveRouteAccessibilityLabel,
    effectiveTransitRoutePresentation,
    handleExpandedContentLayout,
    handleRouteStepPress,
    hasDepartureInfo,
    hasDetailedRoute,
    inspectedParticipant,
    inspectedTravelPlan,
    internalPreviewItem,
    isDark,
    isPlainSchedule,
    item,
    openCurrentRoutePlanner,
    participantDisclosureAnimatedStyle,
    participantsExpanded,
    primaryText,
    recommendedDepartureTimeLabel,
    routeArrivalSummary,
    routeDetailInfo,
    routeDetailMeta,
    routeDurationLabel,
    routeFactLabels,
    routeIdentityTitle,
    routeProgressSegments,
    routeSavePending,
    routeSummaryTitle,
    selectedRoutePassStop,
    selectedRouteStepId,
    secondaryText,
    setInspectedTravelPlan,
    sheetBottomPadding,
    sheetBorder,
    sheetMaxHeight,
    sheetMode,
    sheetPanResponder,
    sheetScrollRef,
    sheetTranslateY,
    snapSheet,
    toggleParticipantsExpanded,
    topCardAccentText,
    topCardControlBg,
  } = presentation;

  return !isPlainSchedule ? (
    <Animated.View
      style={[
        styles.routeSheet,
        {
          height: sheetMaxHeight,
          transform: [{ translateY: sheetTranslateY }],
        },
      ]}
    >
      <CalendarGlassSurface
        variant="sheet"
        tone="flat"
        style={[styles.routeSheetGlass, { borderColor: sheetBorder }]}
      >
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            styles.panelOpaqueBackdrop,
            isDark
              ? styles.panelOpaqueBackdropDark
              : styles.panelOpaqueBackdropLight,
          ]}
        />
        <View
          style={styles.sheetHandleHitArea}
          {...sheetPanResponder.panHandlers}
        >
          <View
            style={[styles.sheetHandle, { backgroundColor: sheetBorder }]}
          />
        </View>
        <ScrollView
          ref={sheetScrollRef}
          style={styles.sheetScroll}
          contentContainerStyle={[
            styles.sheetScrollContent,
            { paddingBottom: sheetBottomPadding },
          ]}
          showsVerticalScrollIndicator={false}
          bounces={false}
          scrollEnabled={sheetMode === 'expanded'}
        >
          <ScheduleDetailRouteQuickSummary presentation={presentation} />
          <View
            onLayout={handleExpandedContentLayout}
            pointerEvents={sheetMode === 'expanded' ? 'auto' : 'none'}
            accessibilityElementsHidden={sheetMode !== 'expanded'}
            importantForAccessibility={
              sheetMode === 'expanded' ? 'auto' : 'no-hide-descendants'
            }
            style={styles.sheetExpandedContent}
          >
            <View
              style={[
                styles.sheetStatusSection,
                { borderBottomColor: sheetBorder },
              ]}
            >
              <View style={styles.improvedExpandedHero}>
                <View style={styles.improvedExpandedIdentityRow}>
                  <View style={styles.improvedRouteIdentityExpanded}>
                    <Ionicons
                      name="navigate-outline"
                      size={15}
                      color={topCardAccentText}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.improvedRouteIdentityTitle,
                        { color: primaryText },
                      ]}
                    >
                      {routeIdentityTitle}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.improvedRouteIdentityMeta,
                        { color: secondaryText },
                      ]}
                    >
                      {travelModeLabel(displayTravelMode ?? undefined)}
                    </Text>
                  </View>
                  <Pressable
                    testID="schedule-route-sheet-collapse"
                    onPress={() => snapSheet('compact')}
                    accessibilityRole="button"
                    accessibilityLabel="일정 상세 시트 접기"
                    accessibilityHint="접힌 경로 요약으로 전환합니다"
                    style={({ pressed }) => [
                      styles.improvedExpandedCollapseButton,
                      { opacity: pressed ? 0.56 : 1 },
                    ]}
                  >
                    <View
                      style={[
                        styles.improvedExpandedCollapseButtonFace,
                        { backgroundColor: topCardControlBg },
                      ]}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={16}
                        color={secondaryText}
                      />
                    </View>
                  </Pressable>
                </View>

                <View style={styles.improvedExpandedHeroMain}>
                  <View style={styles.improvedExpandedHeroCopy}>
                    <Text
                      style={[
                        styles.improvedDepartureEyebrow,
                        { color: topCardAccentText },
                      ]}
                    >
                      권장 출발
                    </Text>
                    <View style={styles.improvedDepartureTimeRow}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.72}
                        style={[
                          styles.improvedExpandedDepartureTime,
                          { color: primaryText },
                        ]}
                      >
                        {recommendedDepartureTimeLabel}
                      </Text>
                      {departureRemainingLabel ? (
                        <View
                          style={[
                            styles.improvedRemainingChip,
                            {
                              backgroundColor: isDark
                                ? 'rgba(41,121,255,0.20)'
                                : 'rgba(41,121,255,0.10)',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.improvedRemainingChipText,
                              { color: topCardAccentText },
                            ]}
                          >
                            {departureRemainingLabel}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.improvedArrivalSummary,
                        { color: secondaryText },
                      ]}
                    >
                      {routeArrivalSummary}
                    </Text>
                  </View>

                  {hasDepartureInfo && (
                    <Pressable
                      onPress={completeDeparture}
                      disabled={departureCompleted || departureActionPending}
                      accessibilityRole="button"
                      accessibilityLabel={
                        departureCompleted ? '출발 완료' : '출발했어요'
                      }
                      accessibilityState={{
                        selected: departureCompleted,
                        busy: departureActionPending,
                        disabled: departureCompleted || departureActionPending,
                      }}
                      style={({ pressed }) => [
                        styles.improvedExpandedDepartureAction,
                        {
                          backgroundColor: departureCompleted
                            ? isDark
                              ? 'rgba(41,121,255,0.20)'
                              : 'rgba(41,121,255,0.12)'
                            : APP_ACCENT_BLUE,
                          opacity: pressed || departureActionPending ? 0.64 : 1,
                        },
                      ]}
                    >
                      {departureActionPending ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Ionicons
                          name={departureCompleted ? 'checkmark' : 'navigate'}
                          size={15}
                          color={
                            departureCompleted ? topCardAccentText : '#FFFFFF'
                          }
                        />
                      )}
                      <Text
                        style={[
                          styles.improvedExpandedDepartureActionText,
                          {
                            color: departureCompleted
                              ? topCardAccentText
                              : '#FFFFFF',
                          },
                        ]}
                      >
                        {departureActionPending
                          ? '처리 중'
                          : departureCompleted
                          ? '출발 완료'
                          : '출발했어요'}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {routeFactLabels.length > 0 ? (
                  <View style={styles.improvedRouteFacts}>
                    {routeFactLabels.map((label, index) => (
                      <React.Fragment key={label}>
                        {index > 0 ? (
                          <View
                            style={[
                              styles.improvedRouteFactDivider,
                              { backgroundColor: sheetBorder },
                            ]}
                          />
                        ) : null}
                        <Text
                          style={[
                            styles.improvedRouteFactText,
                            { color: secondaryText },
                          ]}
                        >
                          {label}
                        </Text>
                      </React.Fragment>
                    ))}
                  </View>
                ) : null}

                {item.myDepartedAt ? (
                  <ScheduleArrivalObservationAction
                    scheduleId={item.id}
                    myDepartedAt={item.myDepartedAt}
                    compact
                  />
                ) : null}
              </View>

              {departureParticipants.length > 1 && (
                <View
                  style={[
                    styles.sheetSharedPeopleSection,
                    { borderTopColor: sheetBorder },
                  ]}
                >
                  <Pressable
                    onPress={toggleParticipantsExpanded}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: participantsExpanded }}
                    accessibilityLabel={`함께하는 사람 ${
                      departureParticipants.length
                    }명, ${departureCountLabel} 출발, 참여자 목록 ${
                      participantsExpanded ? '접기' : '보기'
                    }`}
                    style={({ pressed }) => [
                      styles.sheetParticipantDisclosure,
                      { opacity: pressed ? 0.56 : 1 },
                    ]}
                  >
                    <View style={styles.sheetParticipantDisclosureTitle}>
                      <Ionicons
                        name="people-outline"
                        size={16}
                        color={secondaryText}
                      />
                      <Text
                        style={[
                          styles.sheetSectionTitle,
                          { color: primaryText },
                        ]}
                      >
                        함께하는 사람 {departureParticipants.length}
                      </Text>
                    </View>
                    <View style={styles.sheetParticipantDisclosureSummary}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.sheetParticipantSummary,
                          { color: secondaryText },
                        ]}
                      >
                        {departureCountLabel} 출발
                      </Text>
                      <Animated.View style={participantDisclosureAnimatedStyle}>
                        <Ionicons
                          name="chevron-down"
                          size={14}
                          color={secondaryText}
                        />
                      </Animated.View>
                    </View>
                  </Pressable>
                  {participantsExpanded ? (
                    <View style={styles.sheetParticipantExpandedContent}>
                      {renderDepartureParticipantChips()}
                      {renderTravelPlanRows()}
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {effectiveTransitRoutePresentation ? (
              <View
                accessible
                accessibilityRole="summary"
                accessibilityLabel={effectiveRouteAccessibilityLabel}
                style={[
                  styles.effectiveRouteCard,
                  isDark
                    ? styles.effectiveRouteCardDark
                    : styles.effectiveRouteCardLight,
                ]}
              >
                <View style={styles.effectiveRouteCardHeader}>
                  <View style={styles.effectiveRouteCardTitleRow}>
                    <View
                      style={[
                        styles.effectiveRouteCardIcon,
                        isDark
                          ? styles.effectiveRouteCardIconDark
                          : styles.effectiveRouteCardIconLight,
                      ]}
                    >
                      <Ionicons
                        name="swap-horizontal"
                        size={15}
                        color={topCardAccentText}
                      />
                    </View>
                    <Text
                      style={[
                        styles.effectiveRouteCardTitle,
                        { color: primaryText },
                      ]}
                    >
                      실시간 추천 경로
                    </Text>
                  </View>
                  {effectiveTransitRoutePresentation.summary ? (
                    <Text
                      style={[
                        styles.effectiveRouteCardSummary,
                        { color: topCardAccentText },
                      ]}
                    >
                      {effectiveTransitRoutePresentation.summary}
                    </Text>
                  ) : null}
                </View>
                <Text
                  numberOfLines={3}
                  style={[
                    styles.effectiveRouteCardItinerary,
                    { color: primaryText },
                  ]}
                >
                  {effectiveTransitRoutePresentation.itinerary}
                </Text>
                {effectiveTransitRoutePresentation.waitMeta ? (
                  <View style={styles.effectiveRouteWaitMetaRow}>
                    <Ionicons
                      name="time-outline"
                      size={13}
                      color={topCardAccentText}
                    />
                    <Text
                      style={[
                        styles.effectiveRouteWaitMeta,
                        { color: topCardAccentText },
                      ]}
                    >
                      {effectiveTransitRoutePresentation.waitMeta}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.effectiveRouteMapNoteRow}>
                  <Ionicons
                    name="map-outline"
                    size={13}
                    color={secondaryText}
                  />
                  <Text
                    style={[
                      styles.effectiveRouteMapNote,
                      { color: secondaryText },
                    ]}
                  >
                    {effectiveTransitRoutePresentation.mapNote}
                  </Text>
                </View>
              </View>
            ) : null}

            <>
              <View
                style={[
                  styles.sheetRouteSummary,
                  { borderBottomColor: sheetBorder },
                ]}
              >
                {inspectedTravelPlan && (
                  <View
                    style={[
                      styles.inspectedPlanBar,
                      { borderBottomColor: sheetBorder },
                    ]}
                  >
                    <View style={styles.inspectedPlanIdentity}>
                      <Ionicons
                        name="person-circle-outline"
                        size={17}
                        color={topCardAccentText}
                      />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.inspectedPlanText,
                          { color: primaryText },
                        ]}
                      >
                        {inspectedParticipant
                          ? `${travelPlanParticipantLabel(
                              inspectedParticipant,
                            )}의 이동 계획`
                          : '참여자 이동 계획'}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setInspectedTravelPlan(undefined)}
                      accessibilityRole="button"
                      accessibilityLabel="내 이동 계획으로 돌아가기"
                      style={({ pressed }) => [
                        styles.inspectedPlanClose,
                        { opacity: pressed ? 0.5 : 1 },
                      ]}
                    >
                      <Ionicons name="close" size={17} color={secondaryText} />
                    </Pressable>
                  </View>
                )}
                <View style={styles.sheetRouteTopRow}>
                  <View style={styles.sheetRouteCopy}>
                    {hasDetailedRoute ? (
                      <View style={styles.sheetRouteTitleRow}>
                        <View
                          style={[
                            styles.sheetRouteLiveDot,
                            styles.sheetRouteLiveDotActive,
                          ]}
                        />
                        <Text
                          style={[
                            styles.sheetRouteTitle,
                            styles.sheetRouteTitleInline,
                            { color: primaryText },
                          ]}
                        >
                          {routeSummaryTitle}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <View style={styles.sheetRouteKickerRow}>
                          <View
                            style={[
                              styles.sheetRouteLiveDot,
                              { backgroundColor: secondaryText },
                            ]}
                          />
                          <Text
                            style={[
                              styles.sheetRouteMeta,
                              { color: secondaryText },
                            ]}
                          >
                            {routeDetailMeta}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.sheetRouteTitle,
                            { color: primaryText },
                          ]}
                        >
                          {routeSummaryTitle}
                        </Text>
                      </>
                    )}
                  </View>
                  {!hasDetailedRoute || !inspectedTravelPlan ? (
                    <View style={styles.sheetRouteActions}>
                      {!hasDetailedRoute ? (
                        <Text
                          style={[
                            styles.sheetRouteDuration,
                            { color: primaryText },
                          ]}
                        >
                          {routeDurationLabel}
                        </Text>
                      ) : null}
                      {!inspectedTravelPlan && (
                        <Pressable
                          onPress={openCurrentRoutePlanner}
                          disabled={routeSavePending}
                          accessibilityRole="button"
                          accessibilityLabel={
                            hasDetailedRoute
                              ? '현재 길찾기 화면에서 전체 경로 보기'
                              : '이동 경로 설정'
                          }
                          accessibilityState={{
                            busy: routeSavePending,
                            disabled: routeSavePending,
                          }}
                          style={({ pressed }) => [
                            styles.sheetRouteMapButton,
                            {
                              backgroundColor: pressed
                                ? topCardControlBg
                                : 'transparent',
                              opacity: routeSavePending
                                ? 0.35
                                : pressed
                                ? 0.58
                                : 1,
                            },
                          ]}
                        >
                          {routeSavePending ? (
                            <ActivityIndicator
                              size="small"
                              color={primaryText}
                            />
                          ) : (
                            <Ionicons
                              name="map-outline"
                              size={21}
                              color={primaryText}
                            />
                          )}
                        </Pressable>
                      )}
                    </View>
                  ) : null}
                </View>
                {hasDetailedRoute && routeProgressSegments.length > 0 && (
                  <View style={styles.routeProgressSection}>
                    <TransitRouteProgressBar
                      segments={routeProgressSegments}
                      isDark={isDark}
                      compact
                    />
                  </View>
                )}
              </View>

              {hasDetailedRoute && routeDetailInfo ? (
                <>
                  <View
                    style={[
                      styles.routeDetailHeader,
                      { borderBottomColor: sheetBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.routeDetailSectionTitle,
                        { color: primaryText },
                      ]}
                    >
                      경로 상세
                    </Text>
                    {inspectedTravelPlan ? (
                      <Text
                        style={[
                          styles.routeDetailBaseTimeText,
                          { color: secondaryText },
                        ]}
                      >
                        {hhmmText(fromISO(routeDetailInfo.departureTime))} 출발
                        기준
                      </Text>
                    ) : null}
                  </View>
                  <RouteStepTimeline
                    routeInfo={routeDetailInfo}
                    selectedStepId={selectedRouteStepId}
                    selectedPassStop={selectedRoutePassStop}
                    onStepPress={handleRouteStepPress}
                    allowEndpointPress
                    forceDark={isDark}
                    primaryTextColor={primaryText}
                    secondaryTextColor={secondaryText}
                    compact
                    realtimeArrivalsEnabled={!internalPreviewItem}
                  />
                </>
              ) : (
                <Text style={[styles.sheetEmptyText, { color: secondaryText }]}>
                  저장된 상세 경로가 없어요.
                </Text>
              )}
            </>
          </View>
        </ScrollView>
      </CalendarGlassSurface>
    </Animated.View>
  ) : null;
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
