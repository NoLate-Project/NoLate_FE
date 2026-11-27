import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import {
  Animated,
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
  TRAVEL_MINUTES,
  TRAVEL_MODES,
} from '../../src/routeSupport/onboarding/calendarImportModel';

WebBrowser.maybeCompleteAuthSession();

import CalendarImportStatusMark from '../../src/routeSupport/onboarding/CalendarImportStatusMark';
import CalendarImportEarlySteps from '../../src/routeSupport/onboarding/CalendarImportEarlySteps';
import { useCalendarImportController } from '../../src/routeSupport/onboarding/useCalendarImportController';
import BrandedLoader from '../../src/ui/BrandedLoader';
import { useScreenFirstPaintPerformance } from '../../src/modules/performance/useScreenFirstPaintPerformance';

/** 캘린더 가져오기 흐름의 상태를 화면 단계별 UI에 연결합니다. */
export default function CalendarImportOnboarding() {
  useScreenFirstPaintPerformance('/onboarding/calendar-import');
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
    categoryGroups,
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
    goBackStep,
    goToStep,
    handleCategoryCreated,
    importProgress,
    importSelectedSchedules,
    importedCount,
    importing,
    individualSchedulesExpanded,
    insets,
      isManagementEntry,
    trackScroll,
    lastImportPreparedRoutes,
    lastCandidateButtonRef,
    lastCandidateId,
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
    routeCandidateCount,
    routePreparationEnabled,
    scanCalendars,
    candidateContinueButtonRef,
    scanButtonRef,
    scanStage,
    scanStatusMessage,
    scanWasStopped,
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
    setLastCandidateId,
    toggleCandidateSourceGroup,
    toggleProvider,
    travelMinutes,
    travelMode,
    visibleCandidateCount,
  } = useCalendarImportController();
  const categoryCreationTarget = expandedCategorySourceKey
    ? resolveCalendarImportCategoryAssignment(
        categories,
        categoryId,
        categoryIdBySource,
        expandedCategorySourceKey,
      )
    : selectedCategory;

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
          <Ionicons accessible={false} importantForAccessibility="no" name="chevron-back-outline" size={22} color={colors.textPrimary} />
        </Pressable>
        <CurationProgress step={step} />
      </View>

      <ScrollView
        ref={scrollViewRef}
        onScroll={event => trackScroll(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        style={styles.scroll}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          step === 'scanning' && styles.scanContent,
          (step === 'select' || step === 'enrich') && styles.choicesContent,
        ]}
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
              <View style={styles.choicesHeading}>
                <Text accessibilityRole="header" style={[styles.title, styles.choicesTitle]}>
                  {candidates.length > 0 ? '필요한 일정만\n선택해 주세요' : '가져올 일정 확인'}
                </Text>
                {candidates.length > 0 ? (
                  <Text style={styles.subtitle}>원본 일정은 그대로예요. 저장할 일정만 체크하세요.</Text>
                ) : null}
              </View>
              {errorMessage ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={styles.inlineNotice}
                >
                  <Ionicons accessible={false} importantForAccessibility="no"
                    name="information-circle-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.inlineNoticeText}>{errorMessage}</Text>
                </View>
              ) : null}

              {candidates.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons accessible={false} importantForAccessibility="no"
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
                              buttonRef={lastCandidateId === candidate.id ? lastCandidateButtonRef : undefined}
                              onPress={() => {
                                setLastCandidateId(candidate.id);
                                toggleCandidate(candidate);
                              }}
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
              <Text accessibilityRole="header" style={[styles.title, styles.choicesTitle]}>
                저장할 카테고리를 정해 주세요
              </Text>
              <View style={styles.importChoiceSummary}>
                <Text style={styles.categoryDefaultTitle}>저장할 일정</Text>
                <Text style={styles.categoryDefaultHint}>
                  {selectedCandidates.length}개 · {selectedCandidateSourceGroups.length}개 캘린더
                </Text>
              </View>

              {categoryLoading && categories.length === 0 ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={styles.categoryStatus}
                >
                  <BrandedLoader size="inline" accessibilityLabel="카테고리 불러오는 중" />
                  <Text style={styles.categoryStatusText}>
                    카테고리를 불러오는 중이에요
                  </Text>
                </View>
              ) : categories.length > 0 ? (
                <>
                  <View style={styles.categoryDefaultCard}>
                    <Text accessibilityRole="header" style={styles.categoryDefaultTitle}>기본 카테고리</Text>
                    <View style={styles.categoryGroupList}>
                      {categoryGroups.map(group => (
                        <View key={group.key} style={styles.categoryGroup}>
                          <View style={styles.categoryGroupHeader}>
                            <Ionicons accessible={false} importantForAccessibility="no"
                              name={group.calendarId === null ? 'person-outline' : 'people-outline'}
                              size={15}
                              color={colors.textSecondary}
                            />
                            <Text numberOfLines={1} style={styles.categoryGroupTitle}>
                              {group.title}
                            </Text>
                            <Text style={styles.categoryGroupScope}>{group.scopeLabel}</Text>
                          </View>
                          <View style={styles.chipRow}>
                            {group.categories.map(category => (
                              <OptionChip
                                key={category.id}
                                label={category.title}
                                active={category.id === selectedCategory?.id}
                                color={category.color}
                                onPress={() => selectDefaultCategory(category.id)}
                              />
                            ))}
                        </View>
                      </View>
                    ))}
                    </View>
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
                      <Ionicons accessible={false} importantForAccessibility="no"
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
                  <Ionicons accessible={false} importantForAccessibility="no"
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
                calendarId={categoryCreationTarget?.calendarId}
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
                  <SectionTitle label="선택 설정" />
                  <View style={styles.switchRow}>
                    <View style={styles.departureOptionIcon}>
                      <Ionicons accessible={false} importantForAccessibility="no" name="alarm-outline" size={20} color={BRAND_BLUE} />
                    </View>
                    <View style={styles.switchTextWrap}>
                      <Text style={styles.switchTitle}>
                        출발 알림 함께 준비
                      </Text>
                      <Text style={styles.switchHint}>
                        장소가 있는 일정에 적용
                      </Text>
                    </View>
                    <View style={styles.switchControlWrap}>
                      <Switch
                        accessibilityLabel="출발 알림 함께 준비"
                        value={routePreparationEnabled}
                        onValueChange={setPrepareDepartureAlert}
                        trackColor={{
                          false: mode === 'dark' ? '#34363D' : '#D7D9DF',
                          true: BRAND_BLUE,
                        }}
                        thumbColor="#FFFFFF"
                        style={styles.switchControl}
                      />
                    </View>
                  </View>

                  {routePreparationEnabled ? (
                    <View style={styles.departureOptionsCard}>
                      <Text style={styles.departureFieldTitle}>기본 출발지</Text>
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

                      <Text style={styles.routePreparationNoticeText}>
                        {defaultOriginReady
                          ? '일정 메모에 출발지가 있으면 우선 사용해요.'
                          : '기본 출발지를 고르지 않으면 일정만 가져와요.'}
                      </Text>

                      <Text style={styles.departureFieldTitle}>이동수단</Text>
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

                      <Text style={styles.departureFieldTitle}>경로가 없을 때 예상 이동시간</Text>
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
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          )}

          {step === 'complete' && (
            <View style={styles.stepWrap}>
              <View style={styles.centeredStatusHeader}>
                <CalendarImportStatusMark partial={failedImportCount > 0} />
              </View>
              <View style={styles.importResultHeading}>
                <Text style={styles.importResultKicker}>가져오기 완료</Text>
                <Text accessibilityRole="header" style={[styles.title, styles.importResultTitle]}>
                  {failedImportCount > 0
                    ? '일부 일정을 가져오지 못했어요'
                    : importedCount > 0
                    ? `${importedCount}개 일정을 가져왔어요`
                    : '선택한 일정은 이미 NoLate에 있어요'}
                </Text>
                {failedImportCount === 0 && (
                  <Text style={styles.subtitle}>
                    {importedCount === 0
                      ? '중복 없이 기존 일정을 유지했어요.'
                      : lastImportPreparedRoutes
                      ? '가져온 일정과 준비된 출발 알림을 확인해 보세요.'
                      : '가져온 일정은 내 일정에서 바로 확인할 수 있어요.'}
                  </Text>
                )}
              </View>
              <ImportResultSummary
                importedCount={importedCount}
                alreadyImportedCount={alreadyImportedCount}
                preparedRouteCount={preparedRouteCount}
                notificationReadyCount={notificationReadyCount}
                failedImportCount={failedImportCount}
              />
              {failedImportCount > 0 && (
                <View style={styles.inlineNotice}>
                  <Ionicons accessible={false} importantForAccessibility="no"
                    name="information-circle-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.inlineNoticeText}>가져오지 못한 일정은 원본 캘린더에 남아 있어요.</Text>
                </View>
              )}
            </View>
          )}
        </Animated.View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          // KeyboardAvoidingView의 iOS padding이 루트 paddingBottom을 덮어쓰므로
          // 실제 버튼을 담는 푸터에서 기기별 하단 안전 영역을 직접 보장한다.
          {
            paddingBottom:
              Math.max(insets.bottom, 18) + (step === 'complete' ? 8 : 0),
          },
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
              buttonRef={scanButtonRef}
              label={
                allCalendarConsentsAccepted
                  ? scanWasStopped ? '다시 일정 찾기' : '동의하고 일정 찾기'
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
                buttonRef={candidateContinueButtonRef}
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
              loading={importing}
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
            label={completingCuration ? '완료 상태 저장 중' : isManagementEntry ? '캘린더에서 보기' : 'NoLate 사용법 보기'}
            disabled={completingCuration}
            onPress={finishCuration}
          />
        )}
      </View>

      {importing ? (
        <View
          accessibilityViewIsModal
          importantForAccessibility="yes"
          style={styles.importLoadingOverlay}
        >
          <View
            accessibilityLabel={`일정을 가져오고 있어요, ${importProgress}/${selectedCandidates.length}개 처리 완료`}
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: selectedCandidates.length,
              now: importProgress,
            }}
            style={styles.importLoadingCard}
          >
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <BrandedLoader accessibilityLabel="일정을 가져오고 있어요" />
            </View>
            <Text style={styles.importLoadingTitle}>일정을 가져오고 있어요</Text>
            <Text style={styles.importLoadingText}>
              {importProgress > 0
                ? `${importProgress}/${selectedCandidates.length}개 처리 완료`
                : '선택한 일정과 저장 위치를 준비하고 있어요'}
            </Text>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
