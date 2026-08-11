import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  hasCalendarImportCategoryOverride,
  resolveCalendarImportCategoryAssignment,
} from '../../src/modules/onboarding/calendarImportCategory';
import CalendarImportCategoryCreator from '../../src/modules/onboarding/CalendarImportCategoryCreator';

import {
  CandidateSelectionSummaryRow,
  CandidateSourceRow,
  CategoryAssignmentDisclosure,
  CategoryAssignmentRow,
  ImportResultSummary,
  IndividualScheduleDisclosure,
  SectionTitle,
} from '../../src/routeSupport/onboarding/CalendarImportCandidates';
import { CurationProgress } from '../../src/routeSupport/onboarding/CalendarImportConsent';
import {
  CandidateRow,
  DefaultOriginPicker,
  GhostButton,
  OptionChip,
  PrimaryButton,
} from '../../src/routeSupport/onboarding/CalendarImportControls';
import {
  BRAND_BLUE,
  CANDIDATE_PAGE_SIZE,
  CURATION_APP_LOGO,
  TRAVEL_MINUTES,
  TRAVEL_MODES,
} from '../../src/routeSupport/onboarding/calendarImportModel';

WebBrowser.maybeCompleteAuthSession();

import CalendarImportEarlySteps from '../../src/routeSupport/onboarding/CalendarImportEarlySteps';
import { useCalendarImportController } from '../../src/routeSupport/onboarding/useCalendarImportController';

/** 캘린더 가져오기 흐름의 상태를 화면 단계별 UI에 연결합니다. */
export default function CalendarImportOnboarding() {
  const {
    acceptedCalendarConsentIds,
    allCalendarConsentsAccepted,
    allCandidatesSelected,
    alreadyImportedCount,
    calendarConsentItems,
    canGoBack,
    candidateSourceGroups,
    candidates,
    categories,
    categoryAssignmentsExpanded,
    categoryCreating,
    categoryError,
    categoryId,
    categoryIdBySource,
    categoryLoading,
    categoryOverrideCount,
    changeOriginSearchQuery,
    clearSelectedCandidates,
    completingCuration,
    colors,
    defaultOrigin,
    defaultOriginReady,
    errorMessage,
    exitWithoutImportLabel,
    expandedCalendarConsentIds,
    expandedCategorySourceKey,
    failedImportCount,
    favoriteDeparturePlaces,
    finishCuration,
    footerMotionStyle,
    goBackStep,
    goToStep,
    handleCategoryCreated,
    importProgress,
    importSelectedSchedules,
    importedCount,
    importing,
    individualSchedulesExpanded,
    insets,
    lastImportPreparedRoutes,
    loadCategories,
    notificationReadyCount,
    mode,
    originSearchError,
    originSearchQuery,
    originSearchResults,
    originSearching,
    permissionProviderLabel,
    preparedRouteCount,
    providerCtaLabel,
    providerOptions,
    remainingNotificationQuota,
    routeCandidateCount,
    routePreparationEnabled,
    routesReadyForImport,
    scanCalendars,
    scanStage,
    scanStatusMessage,
    scrollViewRef,
    searchDefaultOrigin,
    selectAllCandidates,
    selectCategoryForSource,
    selectDefaultCategory,
    selectDefaultOrigin,
    selectedCandidateSourceGroups,
    selectedCandidates,
    selectedCategory,
    selectedIds,
    selectedProviderIds,
    setCategoryAssignmentsExpanded,
    setCategoryCreating,
    setExpandedCategorySourceKey,
    setIndividualSchedulesExpanded,
    setPrepareDepartureAlert,
    setTravelMinutes,
    setTravelMode,
    setVisibleCandidateCount,
    step,
    stepMotionStyle,
    styles,
    toggleAllCalendarConsents,
    toggleCalendarConsent,
    toggleCalendarConsentDetail,
    toggleCandidate,
    toggleCandidateSourceGroup,
    toggleProvider,
    travelMinutes,
    travelMode,
    visibleCandidateCount,
  } = useCalendarImportController();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top + 12 }]}
    >
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
      />
      <View style={styles.topRow}>
        <Pressable
          disabled={!canGoBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="이전 단계로 돌아가기"
          accessibilityState={{ disabled: !canGoBack }}
          accessibilityElementsHidden={!canGoBack}
          importantForAccessibility={canGoBack ? 'auto' : 'no-hide-descendants'}
          onPress={goBackStep}
          style={({ pressed }) => [
            styles.backButton,
            !canGoBack && styles.backButtonHidden,
            pressed && canGoBack && styles.pressed,
          ]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <CurationProgress step={step} />
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Animated.View style={[styles.stepMotion, stepMotionStyle]}>
          <CalendarImportEarlySteps
            step={step}
            styles={styles}
            colors={colors}
            providerOptions={providerOptions}
            selectedProviderIds={selectedProviderIds}
            onToggleProvider={toggleProvider}
            permissionProviderLabel={permissionProviderLabel}
            calendarConsentItems={calendarConsentItems}
            acceptedCalendarConsentIds={acceptedCalendarConsentIds}
            expandedCalendarConsentIds={expandedCalendarConsentIds}
            allCalendarConsentsAccepted={allCalendarConsentsAccepted}
            onToggleAllCalendarConsents={toggleAllCalendarConsents}
            onToggleCalendarConsent={toggleCalendarConsent}
            onToggleCalendarConsentDetail={toggleCalendarConsentDetail}
            errorMessage={errorMessage}
            scanStage={scanStage}
            scanStatusMessage={scanStatusMessage}
          />

          {step === 'select' && (
            <View style={styles.stepWrap}>
              <Text pointerEvents="none" style={styles.eyebrow}>
                {candidates.length}개 중 {selectedIds.size}개 선택
              </Text>
              <Text pointerEvents="none" style={styles.title}>
                가져올 일정을{'\n'}확인해 주세요
              </Text>
              <Text pointerEvents="none" style={styles.subtitle}>
                {allCandidatesSelected
                  ? '다가오는 일정을 모두 선택했어요. 필요 없는 일정만 해제하면 돼요.'
                  : '캘린더별로 선택하거나 개별 일정을 펼쳐 조정할 수 있어요.'}
              </Text>
              {errorMessage ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={styles.inlineNotice}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.inlineNoticeText}>{errorMessage}</Text>
                </View>
              ) : null}

              {candidates.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons
                    name="calendar-clear-outline"
                    size={34}
                    color={colors.textDisabled}
                  />
                  <Text style={styles.emptyTitle}>가져올 일정이 없어요</Text>
                  <Text style={styles.emptyText}>
                    일정 화면에서 직접 첫 일정을 만들 수 있어요.
                  </Text>
                </View>
              ) : (
                <>
                  <CandidateSelectionSummaryRow
                    totalCount={candidates.length}
                    selectedCount={selectedIds.size}
                    onPress={
                      allCandidatesSelected
                        ? clearSelectedCandidates
                        : selectAllCandidates
                    }
                  />

                  <SectionTitle label="캘린더별 선택" />
                  <View style={styles.sourceGroupList}>
                    {candidateSourceGroups.map(group => (
                      <CandidateSourceRow
                        key={group.key}
                        group={group}
                        active={group.selectedCount === group.totalCount}
                        onPress={() => toggleCandidateSourceGroup(group.key)}
                      />
                    ))}
                  </View>

                  <IndividualScheduleDisclosure
                    expanded={individualSchedulesExpanded}
                    totalCount={candidates.length}
                    selectedCount={selectedIds.size}
                    onPress={() =>
                      setIndividualSchedulesExpanded(expanded => !expanded)
                    }
                  />

                  {individualSchedulesExpanded ? (
                    <>
                      <View style={styles.candidateList}>
                        {candidates
                          .slice(0, visibleCandidateCount)
                          .map(candidate => (
                            <CandidateRow
                              key={candidate.id}
                              candidate={candidate}
                              selected={selectedIds.has(candidate.id)}
                              onPress={() => toggleCandidate(candidate)}
                            />
                          ))}
                      </View>
                      {visibleCandidateCount < candidates.length ? (
                        <GhostButton
                          label={`일정 더 보기 (${
                            candidates.length - visibleCandidateCount
                          }개 남음)`}
                          onPress={() =>
                            setVisibleCandidateCount(count =>
                              Math.min(
                                count + CANDIDATE_PAGE_SIZE,
                                candidates.length,
                              ),
                            )
                          }
                        />
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </View>
          )}

          {step === 'enrich' && (
            <View style={styles.stepWrap}>
              <Text style={styles.eyebrow}>마지막 설정</Text>
              <Text style={styles.title}>
                일정을 저장할 곳을{'\n'}확인해 주세요
              </Text>
              <Text style={styles.subtitle}>
                {routeCandidateCount > 0
                  ? '카테고리를 정하고, 원하면 출발 알림도 함께 준비할 수 있어요.'
                  : `${selectedCandidates.length}개 일정을 저장할 카테고리를 정해 주세요.`}
              </Text>

              <SectionTitle label="저장 카테고리" />
              <Text style={styles.sectionDescription}>
                선택한 기본값을 모든 일정에 적용해요.
              </Text>
              {categoryLoading && categories.length === 0 ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={styles.categoryStatus}
                >
                  <ActivityIndicator
                    size="small"
                    color={colors.textSecondary}
                  />
                  <Text style={styles.categoryStatusText}>
                    카테고리를 불러오는 중이에요
                  </Text>
                </View>
              ) : categories.length > 0 ? (
                <>
                  <View style={styles.categoryDefaultHeader}>
                    <Text style={styles.categoryDefaultTitle}>
                      기본 카테고리
                    </Text>
                    <Text style={styles.categoryDefaultHint}>
                      {selectedCandidates.length}개 일정에 먼저 적용
                    </Text>
                  </View>
                  <View style={styles.chipRow}>
                    {categories.map(category => (
                      <OptionChip
                        key={category.id}
                        label={category.title}
                        active={category.id === selectedCategory?.id}
                        color={category.color}
                        onPress={() => selectDefaultCategory(category.id)}
                      />
                    ))}
                  </View>
                  {selectedCandidateSourceGroups.length > 1 ? (
                    <View style={styles.categoryAssignmentSection}>
                      <CategoryAssignmentDisclosure
                        expanded={categoryAssignmentsExpanded}
                        overrideCount={categoryOverrideCount}
                        sourceCount={selectedCandidateSourceGroups.length}
                        onPress={() => {
                          setCategoryAssignmentsExpanded(expanded => {
                            if (expanded) setExpandedCategorySourceKey(null);
                            return !expanded;
                          });
                        }}
                      />
                      {categoryAssignmentsExpanded ? (
                        <View style={styles.categoryAssignmentList}>
                          {selectedCandidateSourceGroups.map((group, index) => (
                            <CategoryAssignmentRow
                              key={group.key}
                              group={group}
                              categories={categories}
                              category={resolveCalendarImportCategoryAssignment(
                                categories,
                                categoryId,
                                categoryIdBySource,
                                group.key,
                              )}
                              expanded={expandedCategorySourceKey === group.key}
                              usesDefault={
                                !hasCalendarImportCategoryOverride(
                                  categories,
                                  selectedCategory?.id ?? '',
                                  categoryIdBySource,
                                  group.key,
                                )
                              }
                              last={
                                index ===
                                selectedCandidateSourceGroups.length - 1
                              }
                              onToggle={() =>
                                setExpandedCategorySourceKey(current =>
                                  current === group.key ? null : group.key,
                                )
                              }
                              onSelect={nextCategoryId =>
                                selectCategoryForSource(
                                  group.key,
                                  nextCategoryId,
                                )
                              }
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {categoryError ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="카테고리 목록 다시 불러오기"
                      accessibilityState={{
                        busy: categoryLoading,
                        disabled: categoryCreating,
                      }}
                      disabled={categoryLoading || categoryCreating}
                      onPress={() => loadCategories().catch(() => undefined)}
                      style={({ pressed }) => [
                        styles.categoryStatus,
                        (pressed || categoryLoading || categoryCreating) &&
                          styles.pressed,
                      ]}
                    >
                      <Ionicons
                        name="refresh-outline"
                        size={17}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.categoryStatusText}>
                        최신 목록을 확인하지 못했어요 · 다시 시도
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="카테고리 다시 불러오기"
                  accessibilityState={{
                    busy: categoryLoading,
                    disabled: categoryCreating,
                  }}
                  disabled={categoryLoading || categoryCreating}
                  onPress={() => loadCategories().catch(() => undefined)}
                  style={({ pressed }) => [
                    styles.categoryStatus,
                    styles.categoryStatusError,
                    (pressed || categoryLoading || categoryCreating) &&
                      styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <View style={styles.categoryStatusCopy}>
                    <Text style={styles.categoryStatusTitle}>
                      {categoryError}
                    </Text>
                    <Text style={styles.categoryStatusText}>
                      탭해서 다시 시도
                    </Text>
                  </View>
                </Pressable>
              )}

              <CalendarImportCategoryCreator
                categoryCount={categories.length}
                disabled={categoryLoading || importing || completingCuration}
                assignmentTargetLabel={
                  selectedCandidateSourceGroups.find(
                    group => group.key === expandedCategorySourceKey,
                  )?.title
                }
                onBusyChange={setCategoryCreating}
                onCreated={handleCategoryCreated}
              />

              {routeCandidateCount > 0 ? (
                <>
                  <SectionTitle label="출발 알림" />
                  <Text style={styles.sectionDescription}>
                    선택 사항이에요. 필요할 때만 켜도 돼요.
                  </Text>
                  <View style={styles.switchRow}>
                    <View style={styles.switchTextWrap}>
                      <Text style={styles.switchTitle}>
                        출발 알림 함께 준비
                      </Text>
                      <Text style={styles.switchHint}>
                        {remainingNotificationQuota === 0
                          ? '이번 달 실시간 알림 한도를 모두 사용했어요'
                          : routePreparationEnabled && !defaultOriginReady
                          ? '기본 출발지를 선택해 주세요'
                          : routePreparationEnabled
                          ? `장소가 있는 일정 중 최대 ${remainingNotificationQuota}개 설정`
                          : '장소가 있는 일정의 경로와 알림을 만들어요'}
                      </Text>
                    </View>
                    <Switch
                      accessibilityLabel="출발 알림 함께 준비"
                      value={routePreparationEnabled}
                      onValueChange={setPrepareDepartureAlert}
                      disabled={remainingNotificationQuota === 0}
                      trackColor={{
                        false: mode === 'dark' ? '#34363D' : '#D7D9DF',
                        true: BRAND_BLUE,
                      }}
                      thumbColor="#FFFFFF"
                    />
                  </View>

                  {routePreparationEnabled ? (
                    <>
                      <SectionTitle label="기본 출발지" />
                      <DefaultOriginPicker
                        favorites={favoriteDeparturePlaces}
                        selected={defaultOrigin}
                        query={originSearchQuery}
                        results={originSearchResults}
                        searching={originSearching}
                        error={originSearchError}
                        onQueryChange={changeOriginSearchQuery}
                        onSearch={searchDefaultOrigin}
                        onSelect={selectDefaultOrigin}
                      />

                      <View style={styles.routePreparationNotice}>
                        <Ionicons
                          name="sparkles-outline"
                          size={17}
                          color={BRAND_BLUE}
                        />
                        <Text style={styles.routePreparationNoticeText}>
                          일정 메모에 출발지가 있으면 우선 사용하고, 없으면 기본
                          출발지에서 경로를 만들어요.
                        </Text>
                      </View>

                      <SectionTitle label="이동수단" />
                      <View style={styles.chipRow}>
                        {TRAVEL_MODES.map(option => (
                          <OptionChip
                            key={option.value}
                            label={option.label}
                            icon={option.icon}
                            active={travelMode === option.value}
                            onPress={() => setTravelMode(option.value)}
                          />
                        ))}
                      </View>

                      <SectionTitle label="경로가 없을 때 예상 이동시간" />
                      <View style={styles.chipRow}>
                        {TRAVEL_MINUTES.map(minutes => (
                          <OptionChip
                            key={minutes}
                            label={`${minutes}분`}
                            active={travelMinutes === minutes}
                            onPress={() => setTravelMinutes(minutes)}
                          />
                        ))}
                      </View>
                    </>
                  ) : null}
                </>
              ) : null}
            </View>
          )}

          {step === 'complete' && (
            <View style={styles.stepWrap}>
              <Image
                accessible
                accessibilityLabel="NoLate"
                accessibilityRole="image"
                source={CURATION_APP_LOGO}
                resizeMode="cover"
                style={styles.completeLogo}
              />
              <Text style={styles.title}>
                {importedCount > 0
                  ? `${importedCount}개 일정을\nNoLate로 가져왔어요`
                  : '선택한 일정은\n이미 NoLate에 있어요'}
              </Text>
              <Text style={styles.subtitle}>
                {importedCount === 0
                  ? '중복으로 저장하지 않고 기존 일정을 그대로 유지했어요.'
                  : lastImportPreparedRoutes
                  ? '가져온 일정과 준비된 출발 알림을 확인해 보세요.'
                  : '가져온 일정은 내 일정에서 바로 확인할 수 있어요.'}
              </Text>
              <ImportResultSummary
                importedCount={importedCount}
                alreadyImportedCount={alreadyImportedCount}
                preparedRouteCount={preparedRouteCount}
                notificationReadyCount={notificationReadyCount}
                failedImportCount={failedImportCount}
              />
            </View>
          )}
        </Animated.View>
      </ScrollView>

      <Animated.View
        style={[
          styles.footer,
          // KeyboardAvoidingView의 iOS padding이 루트 paddingBottom을 덮어쓰므로
          // 실제 버튼을 담는 푸터에서 기기별 하단 안전 영역을 직접 보장한다.
          {
            paddingBottom:
              Math.max(insets.bottom, 18) + (step === 'complete' ? 8 : 0),
          },
          footerMotionStyle,
        ]}
      >
        {step === 'intro' && (
          <>
            <PrimaryButton
              label="캘린더 선택하기"
              onPress={() => goToStep('provider')}
            />
            <GhostButton
              label={exitWithoutImportLabel}
              disabled={completingCuration}
              onPress={finishCuration}
            />
          </>
        )}
        {step === 'provider' && (
          <>
            <PrimaryButton
              label={providerCtaLabel}
              disabled={selectedProviderIds.size === 0}
              onPress={() => goToStep('permission')}
            />
            <GhostButton
              label={exitWithoutImportLabel}
              disabled={completingCuration}
              onPress={finishCuration}
            />
          </>
        )}
        {step === 'permission' && (
          <>
            <PrimaryButton
              label={
                allCalendarConsentsAccepted
                  ? '동의하고 일정 찾기'
                  : '필수 항목을 확인해 주세요'
              }
              disabled={!allCalendarConsentsAccepted}
              onPress={scanCalendars}
            />
            <GhostButton
              label={exitWithoutImportLabel}
              disabled={completingCuration}
              onPress={finishCuration}
            />
          </>
        )}
        {step === 'scanning' && (
          <GhostButton label="이전으로 돌아가기" onPress={goBackStep} />
        )}
        {step === 'select' && (
          <>
            {candidates.length === 0 ? (
              <PrimaryButton
                label={exitWithoutImportLabel}
                disabled={completingCuration}
                onPress={finishCuration}
              />
            ) : (
              <PrimaryButton
                label={
                  selectedIds.size > 0
                    ? `${selectedIds.size}개 일정 계속하기`
                    : '가져올 일정을 선택해 주세요'
                }
                disabled={selectedIds.size === 0}
                onPress={() => goToStep('enrich')}
              />
            )}
            <GhostButton
              label={candidates.length === 0 ? '캘린더 다시 선택' : '이전'}
              onPress={goBackStep}
            />
          </>
        )}
        {step === 'enrich' && (
          <>
            {routePreparationEnabled && !routesReadyForImport && !importing ? (
              <View style={styles.footerNotice}>
                <Ionicons
                  name="information-circle-outline"
                  size={15}
                  color={colors.textSecondary}
                />
                <Text style={styles.footerNoticeText}>
                  출발지를 고르지 않으면 일정만 가져와요
                </Text>
              </View>
            ) : null}
            <PrimaryButton
              label={
                categoryCreating
                  ? '카테고리를 추가하는 중'
                  : importing
                  ? `${importProgress}/${selectedCandidates.length} 가져오는 중`
                  : categoryLoading && !selectedCategory
                  ? '카테고리를 불러오는 중'
                  : !selectedCategory
                  ? '카테고리를 다시 불러와 주세요'
                  : `${selectedCandidates.length}개 일정 가져오기`
              }
              disabled={categoryCreating || importing || !selectedCategory}
              onPress={importSelectedSchedules}
            />
            <GhostButton
              label="이전"
              disabled={categoryCreating || importing}
              onPress={() => goToStep('select')}
            />
          </>
        )}
        {step === 'complete' && (
          <PrimaryButton
            label={completingCuration ? '완료 상태 저장 중' : '내 일정 보기'}
            disabled={completingCuration}
            onPress={finishCuration}
          />
        )}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}
