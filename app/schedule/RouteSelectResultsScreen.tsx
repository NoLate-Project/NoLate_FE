import React from "react";
import {
    Animated,
    Pressable,
    ScrollView,
    StatusBar,
    Text,
    TextInput,
    View,
} from "react-native";

import RouteEndpointReselectCard from "../../src/modules/schedule/components/route/RouteEndpointReselectCard";
import TransitRouteProgressBar from "../../src/modules/schedule/components/route/TransitRouteProgressBar";
import { TRAVEL_MODE_META } from "../../src/modules/schedule/travelMode";
import { shouldShowRequiredMapAttribution } from "../../src/modules/map/routingService";
import {
    buildRouteInfoFromAlternative,
    formatRouteDuration as formatRouteInfoDuration,
} from "../../src/modules/schedule/routeInfo";
import { getNaverLikeRouteRecommendationLabel } from "../../src/modules/schedule/routeAlternativeRanking";
import BrandedLoader from "../../src/ui/BrandedLoader";
import styles from "./route-select.styles";
import {
    AnimatedRouteCardShell,
    AnimatedRouteExpansion,
    AnimatedTransitFilterButton,
    AnimatedTravelModeButton,
    Ionicons,
    SELECTABLE_TRAVEL_MODES,
    TRANSIT_FILTER_ITEMS,
    TRAVEL_MODE_ICONS,
    configureRouteExpansionAnimation,
} from "./RouteSelectAnimatedControls";
import {
    buildRouteBoardingSummary,
    buildRouteDropdownSummaryItems,
    buildRouteMetricChips,
    buildRouteProgressSegments,
    formatCurrentRouteNoticeTime,
    formatRouteTimeFare,
    formatScheduleRouteNoticeTime,
    isRideLegKind,
} from "./routeSelectRouteModel";
import type { RouteSelectController } from "./useRouteSelectController";

type RouteSelectResultsScreenProps = {
    controller: RouteSelectController;
};

/** 출발지·도착지 입력과 이동수단별 경로 대안, 상세 펼침 및 저장 동작을 표시한다. */
export function RouteSelectResultsScreen({
    controller,
}: RouteSelectResultsScreenProps) {
    const {
        statusBarStyle,
        insets,
        isDark,
        originText,
        destinationText,
        travelMode,
        setActiveTarget,
        setIsEditingRoutePoint,
        selectedRouteId,
        setSelectedRouteId,
        transitRouteFilter,
        routeLoading,
        routeError,
        routeSubmitPending,
        routePointUiRevisionRef,
        routeDepartureAt,
        routeScheduleBased,
        routeTargetArrivalAt,
        origin,
        destination,
        hasRouteCoords,
        shouldShowRouteResults,
        transitFilterCounts,
        visibleRouteAlternatives,
        routeContentAnimatedStyle,
        selectTravelMode,
        selectTransitFilter,
        hasTransitFilters,
        routeListBottomPadding,
        close,
        goToScheduleList,
        openRoutePointEditor,
        handleSearchChange,
        swapPlaces,
        retryRouteSearch,
        openRouteAttribution,
        openMapForOption,
        saveRouteOption,
        routeUi,
    } = controller;
    return (
        <View
            style={[
                styles.screen,
                {
                    backgroundColor: routeUi.background,
                    paddingTop: shouldShowRouteResults ? Math.max(insets.top - 10, 24) : insets.top + 8,
                },
            ]}
        >
            <StatusBar barStyle={statusBarStyle} />
            {!shouldShowRouteResults && (
                <View style={styles.headerRow}>
                    <Pressable
                        onPress={close}
                        accessibilityRole="button"
                        accessibilityLabel="이동 경로 화면 닫기"
                        style={[styles.headerButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                    >
                        <Text style={[styles.headerButtonText, { color: routeUi.textPrimary }]}>‹</Text>
                    </Pressable>
                    <View style={styles.headerTitleWrap}>
                        <Text style={[styles.headerTitle, { color: routeUi.textPrimary }]}>이동 경로</Text>
                        <Text style={[styles.headerSubtitle, { color: routeUi.textSecondary }]}>
                            출발지와 도착지를 입력하고 경로를 선택하세요
                        </Text>
                    </View>
                    <Pressable
                        onPress={goToScheduleList}
                        accessibilityRole="button"
                        accessibilityLabel="일정 목록으로 이동"
                        style={[styles.headerScheduleButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="calendar-outline" size={17} color={routeUi.textPrimary} />
                        <Text style={[styles.headerScheduleButtonText, { color: routeUi.textPrimary }]}>일정</Text>
                    </Pressable>
                </View>
            )}

            <ScrollView
                directionalLockEnabled
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.content, { paddingBottom: routeListBottomPadding }]}
            >
                {!shouldShowRouteResults && (
                    <View style={[styles.routeCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                        <View style={styles.routeInputRows}>
                            <View style={styles.routeRail}>
                                <View style={[styles.routeDot, { borderColor: routeUi.accentGreen, backgroundColor: "transparent" }]} />
                                <View style={[styles.routeRailLine, { backgroundColor: routeUi.border }]} />
                                <View style={[styles.routeDot, { borderColor: routeUi.accentRed, backgroundColor: "transparent" }]} />
                            </View>
                            <View style={styles.routeInputs}>
                                <TextInput
                                    value={originText}
                                    onFocus={() => {
                                        routePointUiRevisionRef.current += 1;
                                        setActiveTarget("origin");
                                        setIsEditingRoutePoint(true);
                                    }}
                                    onChangeText={(text) => handleSearchChange("origin", text)}
                                    accessibilityLabel="출발지 검색"
                                    accessibilityHint="장소 이름이나 주소를 입력하세요"
                                    placeholder="출발지를 입력하세요"
                                    placeholderTextColor={routeUi.inputPlaceholder}
                                    textContentType="none"
                                    autoComplete="off"
                                    secureTextEntry={false}
                                    style={[styles.routeInput, { color: routeUi.textPrimary, borderBottomColor: routeUi.inputBorder }]}
                                />
                                <TextInput
                                    value={destinationText}
                                    onFocus={() => {
                                        routePointUiRevisionRef.current += 1;
                                        setActiveTarget("destination");
                                        setIsEditingRoutePoint(true);
                                    }}
                                    onChangeText={(text) => handleSearchChange("destination", text)}
                                    accessibilityLabel="도착지 검색"
                                    accessibilityHint="장소 이름이나 주소를 입력하세요"
                                    placeholder="도착지를 입력하세요"
                                    placeholderTextColor={routeUi.inputPlaceholder}
                                    textContentType="none"
                                    autoComplete="off"
                                    secureTextEntry={false}
                                    style={[styles.routeInput, { color: routeUi.textPrimary }]}
                                />
                            </View>
                            <Pressable
                                onPress={swapPlaces}
                                accessibilityRole="button"
                                accessibilityLabel="출발지와 도착지 바꾸기"
                                style={[styles.swapButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                            >
                                <Text style={[styles.swapButtonText, { color: routeUi.textSecondary }]}>⇅</Text>
                            </Pressable>
                        </View>

                    </View>
                )}

                {shouldShowRouteResults && (
                    <View style={styles.routeResultHeaderRow}>
                        <RouteEndpointReselectCard
                            originText={originText}
                            destinationText={destinationText}
                            onEditOrigin={() => openRoutePointEditor("origin")}
                            onEditDestination={() => openRoutePointEditor("destination")}
                            onSwap={swapPlaces}
                            colors={{
                                surface: routeUi.surface,
                                surface2: routeUi.surface2,
                                border: routeUi.border,
                                textPrimary: routeUi.textPrimary,
                                textSecondary: routeUi.textSecondary,
                                accentGreen: routeUi.accentGreen,
                                accentRed: routeUi.accentRed,
                            }}
                            style={styles.routeCompactCardInHeader}
                        />
                        <Pressable
                            onPress={goToScheduleList}
                            accessibilityRole="button"
                            accessibilityLabel="일정 목록으로 이동"
                            style={[styles.routeResultScheduleButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}
                        >
                            <Ionicons name="calendar-outline" size={20} color={routeUi.textPrimary} />
                            <Text style={[styles.routeResultScheduleButtonText, { color: routeUi.textSecondary }]}>일정</Text>
                        </Pressable>
                    </View>
                )}

                {shouldShowRouteResults && (
                <View style={styles.modeRow}>
                    {SELECTABLE_TRAVEL_MODES.map((modeItem) => {
                        const selected = travelMode === modeItem;
                        return (
                            <AnimatedTravelModeButton
                                key={modeItem}
                                selected={selected}
                                label={TRAVEL_MODE_META[modeItem].label}
                                iconName={TRAVEL_MODE_ICONS[modeItem] ?? "navigate"}
	                                backgroundColor={selected ? routeUi.selectedModeBg : "transparent"}
                                borderColor={selected ? "rgba(41,121,255,0.95)" : "transparent"}
                                textColor={selected ? routeUi.accentBlue : routeUi.textSecondary}
                                onPress={() => selectTravelMode(modeItem)}
                            />
                        );
                    })}
                </View>
                )}

                {shouldShowRouteResults && (
                    <Animated.View style={routeContentAnimatedStyle}>
                {hasTransitFilters && (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
	                        contentContainerStyle={[styles.transitFilterRow, { borderBottomColor: routeUi.border }]}
                    >
                        {TRANSIT_FILTER_ITEMS.map((item) => {
                            const selected = transitRouteFilter === item.key;
                            const count = transitFilterCounts[item.key];
                            const disabled = item.key !== "ALL" && count === 0;
                            const label = item.key === "ALL" ? item.label : `${item.label} ${count}`;
                            return (
                                <AnimatedTransitFilterButton
                                    key={item.key}
                                    onPress={() => selectTransitFilter(item.key)}
                                    disabled={disabled}
                                    selected={selected}
                                    label={label}
                                    textColor={selected ? routeUi.textPrimary : routeUi.textSecondary}
                                    accentColor={routeUi.accentBlue}
                                />
                            );
                        })}
                    </ScrollView>
                )}

                {hasTransitFilters && visibleRouteAlternatives.length > 0 && (
                    <View style={styles.currentRouteNotice}>
                        <View style={styles.currentRouteTimeGroup}>
                            <Text style={[styles.currentRouteNoticeText, { color: routeUi.textDisabled }]}>
                                {routeScheduleBased ? "일정" : "현재 시간"}
                            </Text>
                            <Text style={[styles.currentRouteNoticeTimeText, { color: routeUi.accentBlue }]}>
                                {routeScheduleBased && routeTargetArrivalAt
                                    ? `${formatScheduleRouteNoticeTime(routeTargetArrivalAt)} 도착`
                                    : formatCurrentRouteNoticeTime(routeDepartureAt)}
                            </Text>
                            <Text style={[styles.currentRouteNoticeText, { color: routeUi.textDisabled }]}>
                                기준
                            </Text>
                        </View>
                        <View accessibilityLabel="추천 경로순" style={styles.currentRouteSortGroup}>
                            <Text style={[styles.currentRouteSortText, { color: routeUi.textSecondary }]}>
                                추천 경로순
                            </Text>
                        </View>
                    </View>
                )}

                    <View style={styles.routeList}>
                    {hasRouteCoords && routeLoading && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <BrandedLoader
                                size="section"
                                variant="route"
                                accessibilityLabel="경로를 계산하고 있어요"
                            />
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>경로 계산 중...</Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !!routeError && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>{routeError}</Text>
                            <Pressable
                                onPress={retryRouteSearch}
                                accessibilityRole="button"
                                accessibilityLabel="경로 다시 검색"
                                style={[styles.emptyRetryButton, { backgroundColor: routeUi.accentBlue }]}
                            >
                                <Ionicons name="refresh" size={15} color="#FFFFFF" />
                                <Text style={styles.emptyRetryText}>다시 검색</Text>
                            </Pressable>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !routeError && visibleRouteAlternatives.length === 0 && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>
                                선택한 교통수단에 해당하는 경로가 없습니다.
                            </Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !routeError && visibleRouteAlternatives.map((option, displayIndex) => {
                        const selected = selectedRouteId === option.id;
                        const routeInfo = buildRouteInfoFromAlternative(
                            option,
                            origin ?? undefined,
                            destination ?? undefined,
                            routeDepartureAt,
                            displayIndex
                        );
                        const progressSegments = buildRouteProgressSegments(option);
                        const routeMetricChips = buildRouteMetricChips(option);
                        const accent = selected ? routeUi.selectedBorder : routeUi.border;
                        const cardBackground = selected ? routeUi.selectedSurface : routeUi.surface;
                        const routeTimeFare = formatRouteTimeFare(option, routeDepartureAt);
                        const routeBoardingSummary = buildRouteBoardingSummary(option, originText);
                        const dropdownSummaryItems = buildRouteDropdownSummaryItems(
                            option,
                            originText,
                            destinationText
                        );
                        const selectRoute = () => {
                            configureRouteExpansionAnimation();
                            setSelectedRouteId(option.id);
                        };
                        return (
                            <View key={option.id} style={styles.routeCandidateItem}>
                                <AnimatedRouteCardShell
                                    selected={selected}
                                    style={[
                                        styles.routeOptionCard,
                                        {
                                            backgroundColor: cardBackground,
                                            borderColor: accent,
                                        },
	                                        selected
	                                            ? (isDark ? styles.routeOptionCardSelectedDark : styles.routeOptionCardSelectedLight)
	                                            : styles.routeOptionCardInactive,
	                                    ]}
	                                >
	                                    <Pressable
                                            onPress={selectRoute}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${formatRouteInfoDuration(routeInfo.totalDurationMinutes)} 경로`}
                                            accessibilityState={{ selected, expanded: selected }}
                                            style={styles.routeOptionPressable}
                                        >
                                        <View style={styles.routeOptionHeader}>
                                            <View style={styles.routeOptionHeaderRow}>
                                                <View style={styles.routeOptionTitleMetaRow}>
                                                    <View
                                                        style={[
                                                            styles.routeOptionLabelPill,
                                                            { backgroundColor: selected ? routeUi.selectedBorder : routeUi.surface2 },
                                                        ]}
                                                    >
                                                        {selected && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
                                                        <Text style={[styles.routeOptionLabel, { color: selected ? "#FFFFFF" : routeUi.textSecondary }]}>
                                                            {getNaverLikeRouteRecommendationLabel(
                                                                option,
                                                                visibleRouteAlternatives,
                                                                displayIndex
                                                            )}
                                                        </Text>
                                                    </View>
                                                    {!!routeTimeFare && (
                                                        <Text numberOfLines={1} style={[styles.routeOptionTimeFare, { color: routeUi.textSecondary }]}>
                                                            {routeTimeFare}
                                                        </Text>
                                                    )}
                                                </View>
                                                <View style={styles.routeOptionDurationWrap}>
                                                    <Text numberOfLines={1} style={[styles.routeOptionDuration, { color: routeUi.textPrimary }]}>
                                                        {formatRouteInfoDuration(routeInfo.totalDurationMinutes)}
                                                    </Text>
                                                </View>
                                            </View>
                                            {routeMetricChips.length > 0 && <View style={styles.routeMetricRow}>
                                                {routeMetricChips.map((metric) => {
                                                    return (
                                                        <View
                                                            key={`${option.id}-${metric.key}`}
                                                            style={[
                                                                styles.routeMetricChip,
                                                                {
                                                                    backgroundColor: routeUi.neutralChipBg,
                                                                    borderColor: routeUi.neutralChipBorder,
                                                                },
                                                            ]}
                                                        >
                                                            <Text
                                                                numberOfLines={1}
                                                                style={[
                                                                    styles.routeMetricText,
                                                                    { color: routeUi.textSecondary },
                                                                ]}
                                                            >
                                                                {metric.label}
                                                            </Text>
                                                        </View>
                                                    );
                                                })}
                                            </View>}
                                            {progressSegments.length > 0 && (
                                                <TransitRouteProgressBar
                                                    segments={progressSegments}
                                                    isDark={isDark}
                                                    compact
                                                />
	                                        )}
	                                            {!selected && !!routeBoardingSummary && (
	                                                <View
	                                                    style={[styles.routeBoardingSummaryRow, { borderTopColor: routeUi.border }]}
	                                                >
	                                                    <Ionicons name="navigate-circle-outline" size={17} color={routeUi.textSecondary} />
	                                                    <Text
	                                                        numberOfLines={1}
	                                                        style={[styles.routeBoardingSummaryText, { color: routeUi.textSecondary }]}
	                                                    >
	                                                        {routeBoardingSummary}
	                                                    </Text>
	                                                </View>
	                                            )}
	                                        </View>
									</Pressable>
                                    {selected && dropdownSummaryItems.length > 0 && (
                                        <AnimatedRouteExpansion
                                            style={[
                                                styles.routeOptionExpansion,
                                                { borderTopColor: routeUi.border },
                                            ]}
                                        >
                                            <View style={styles.routeDropdownSummaryList}>
                                                {dropdownSummaryItems.map((summary, summaryIndex) => {
                                                    const isRide = isRideLegKind(summary.kind);
                                                    const itemColor = summary.color ??
                                                        (summary.kind === "TRANSFER"
                                                            ? routeUi.textSecondary
                                                            : routeUi.borderStrong);
                                                    const iconName: React.ComponentProps<typeof Ionicons>["name"] =
                                                        summary.kind === "SUBWAY"
                                                            ? "train"
                                                            : summary.kind === "BUS"
                                                                ? "bus"
                                                                : summary.kind === "TRANSFER"
                                                                    ? "swap-horizontal"
                                                                    : summary.kind === "WALK"
                                                                        ? "walk"
                                                                        : "navigate-outline";
                                                    return (
                                                        <View key={summary.key} style={styles.routeDropdownSummaryRow}>
                                                            <View style={styles.routeDropdownMarkerColumn}>
                                                                <View
                                                                    style={[
                                                                        styles.routeDropdownIcon,
                                                                        {
                                                                            borderColor: itemColor,
                                                                            backgroundColor: isRide ? itemColor : "transparent",
                                                                        },
                                                                    ]}
                                                                >
                                                                    <Ionicons
                                                                        name={iconName}
                                                                        size={14}
                                                                        color={isRide ? "#FFFFFF" : itemColor}
                                                                    />
                                                                </View>
                                                                {summaryIndex < dropdownSummaryItems.length - 1 && (
                                                                    <View
                                                                        style={[
                                                                            styles.routeDropdownConnector,
                                                                            { backgroundColor: itemColor },
                                                                        ]}
                                                                    />
                                                                )}
                                                            </View>
                                                            <View style={styles.routeDropdownStepTextWrap}>
                                                                <Text
                                                                    numberOfLines={1}
                                                                    style={[
                                                                        styles.routeDropdownStepLine,
                                                                        { color: isRide ? itemColor : routeUi.textPrimary },
                                                                    ]}
                                                                >
                                                                    {summary.title}
                                                                </Text>
                                                                {!!summary.subtitle && (
                                                                    <Text
                                                                        numberOfLines={1}
                                                                        style={[
                                                                            styles.routeDropdownStepMeta,
                                                                            { color: routeUi.textSecondary },
                                                                        ]}
                                                                    >
                                                                        {summary.subtitle}
                                                                    </Text>
                                                                )}
                                                            </View>
                                                        </View>
                                                    );
                                                })}
                                            </View>
                                        </AnimatedRouteExpansion>
                                    )}
                                    {shouldShowRequiredMapAttribution(option) && !!option.attributionText && !!option.attributionUrl && (
                                        <Pressable
                                            accessibilityRole="link"
                                            accessibilityLabel={`${option.attributionText} 지도 정보 열기`}
                                            onPress={() => openRouteAttribution(option)}
                                            style={[styles.routeAttributionLink, { borderTopColor: routeUi.border }]}
                                        >
                                            <Text style={[styles.routeAttributionText, { color: routeUi.textSecondary }]}>
                                                {option.attributionText} · 지도 수정
                                            </Text>
                                            <Ionicons name="open-outline" size={13} color={routeUi.textSecondary} />
                                        </Pressable>
                                    )}
									{selected && (
                                        <View
                                            style={[
                                                styles.routeCardActions,
                                                { borderTopColor: routeUi.border },
                                            ]}
                                        >
                                            <Pressable
                                                onPress={() => openMapForOption(option)}
                                                accessibilityRole="button"
                                                accessibilityLabel="경로 상세 보기"
                                                style={[
                                                    styles.routeCardSecondaryButton,
                                                    {
                                                        backgroundColor: routeUi.surface,
                                                        borderColor: routeUi.border,
                                                    },
                                                ]}
                                            >
                                                <Ionicons name="map-outline" size={15} color={routeUi.textPrimary} />
                                                <Text style={[styles.routeCardSecondaryButtonText, { color: routeUi.textPrimary }]}>
                                                    경로 상세 보기
                                                </Text>
                                            </Pressable>
                                            <Pressable
                                                onPress={() => saveRouteOption(option, displayIndex)}
                                                disabled={routeSubmitPending}
                                                accessibilityRole="button"
                                                accessibilityLabel="이 경로 저장"
                                                accessibilityState={{
                                                    busy: routeSubmitPending,
                                                    disabled: routeSubmitPending,
                                                }}
                                                style={[
                                                    styles.routeCardPrimaryButton,
                                                    {
                                                        backgroundColor: routeUi.accentBlue,
                                                        opacity: routeSubmitPending ? 0.58 : 1,
                                                    },
                                                ]}
                                            >
                                                {routeSubmitPending ? (
                                                    <BrandedLoader
                                                        size="button"
                                                        variant="route"
                                                        accessibilityLabel="선택한 경로를 저장하고 있어요"
                                                    />
                                                ) : (
                                                    <Text style={styles.routeCardPrimaryButtonText}>
                                                        이 경로로 저장
                                                    </Text>
                                                )}
                                            </Pressable>
                                        </View>
                                    )}
	                                </AnimatedRouteCardShell>
	                            </View>
                        );
                    })}
                    </View>
                    </Animated.View>
                )}
            </ScrollView>
        </View>
    );

}
