import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";
import type { RouteInfo, RouteStep } from "../../routeInfo";
import type { TransitRouteProgressSegment } from "../../transitRouteProgress";
import RouteStepTimeline from "../route/RouteStepTimeline";
import TransitRouteProgressBar from "../route/TransitRouteProgressBar";

export type RouteDetailDesignVariant = "current" | "improved";
export type RouteDetailPreviewSheetMode = "compact" | "expanded";

type Props = {
    variant: RouteDetailDesignVariant;
    initialSheetMode?: RouteDetailPreviewSheetMode;
    routeDetailInfo: RouteInfo;
    routeProgressSegments: TransitRouteProgressSegment[];
};

type PreviewPalette = {
    background: string;
    sheet: string;
    sheetMuted: string;
    border: string;
    text: string;
    secondary: string;
    tertiary: string;
    blue: string;
    blueSoft: string;
    map: string;
    mapRoad: string;
    mapRoadEdge: string;
    green: string;
    greenSoft: string;
};

const BLUE = "#2878F0";
const LINE_2 = "#2FA857";
const LINE_4 = "#3D78D8";

function buildPalette(isDark: boolean): PreviewPalette {
    if (isDark) {
        return {
            background: "#0D1015",
            sheet: "#171A20",
            sheetMuted: "#20242C",
            border: "rgba(255,255,255,0.10)",
            text: "#F6F7F9",
            secondary: "#A8AFBA",
            tertiary: "#707987",
            blue: "#4B9DFF",
            blueSoft: "rgba(75,157,255,0.16)",
            map: "#1D232B",
            mapRoad: "#313945",
            mapRoadEdge: "#171C23",
            green: "#43C875",
            greenSoft: "rgba(67,200,117,0.16)",
        };
    }

    return {
        background: "#F6F7F9",
        sheet: "#FFFFFF",
        sheetMuted: "#F4F6F8",
        border: "#E7E9ED",
        text: "#111318",
        secondary: "#656C78",
        tertiary: "#9AA1AC",
        blue: BLUE,
        blueSoft: "#EAF2FF",
        map: "#E9EDF0",
        mapRoad: "#FFFFFF",
        mapRoadEdge: "#DDE2E6",
        green: LINE_2,
        greenSoft: "#EAF7EF",
    };
}

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
                <Text style={[styles.mapPinLabelText, { color: palette.text }]}>{label}</Text>
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
                    name={destination ? "flag" : "ellipse"}
                    size={destination ? 11 : 7}
                    color={palette.sheet}
                />
            </View>
        </View>
    );
}

function RouteMap({ palette, selectedLeg }: { palette: PreviewPalette; selectedLeg: string | null }) {
    return (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.map }]}>
            <View style={[styles.mapPark, { backgroundColor: `${palette.green}18` }]} />
            <MapRoad left="-12%" top="21%" width="132%" rotate="12deg" palette={palette} major />
            <MapRoad left="-18%" top="44%" width="142%" rotate="-8deg" palette={palette} major />
            <MapRoad left="10%" top="67%" width="108%" rotate="18deg" palette={palette} major />
            <MapRoad left="9%" top="13%" width="92%" rotate="72deg" palette={palette} />
            <MapRoad left="43%" top="8%" width="82%" rotate="86deg" palette={palette} />
            <MapRoad left="-2%" top="62%" width="85%" rotate="-66deg" palette={palette} />
            <MapRoad left="56%" top="56%" width="74%" rotate="-52deg" palette={palette} />
            <Text style={[styles.mapDistrict, styles.mapDistrictYongsan, { color: palette.tertiary }]}>용산구</Text>
            <Text style={[styles.mapDistrict, styles.mapDistrictSeocho, { color: palette.tertiary }]}>서초구</Text>
            <Text style={[styles.mapDistrict, styles.mapDistrictGangnam, { color: palette.tertiary }]}>강남구</Text>

            <RouteLine left={70} top={201} width={91} rotate="18deg" color={LINE_4} />
            <RouteLine left={148} top={220} width={106} rotate="46deg" color={LINE_4} />
            <RouteLine left={225} top={285} width={97} rotate="18deg" color={LINE_2} />
            <RouteLine left={304} top={303} width={62} rotate="-28deg" color={LINE_2} />

            {selectedLeg ? (
                <View style={[styles.selectedMapLeg, { backgroundColor: palette.sheet, borderColor: palette.border }]}>
                    <View style={[styles.selectedMapLegDot, { backgroundColor: selectedLeg === "4호선" ? LINE_4 : LINE_2 }]} />
                    <Text style={[styles.selectedMapLegText, { color: palette.text }]}>{selectedLeg} 구간</Text>
                </View>
            ) : null}

            <MapPin left={55} top={173} label="서울역" palette={palette} />
            <MapPin left={326} top={278} label="강남역" destination palette={palette} />
        </View>
    );
}

function HeaderIcon({
    icon,
    label,
    color,
    pressedColor,
}: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
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

function PreviewHeader({
    variant,
    palette,
    topInset,
}: {
    variant: RouteDetailDesignVariant;
    palette: PreviewPalette;
    topInset: number;
}) {
    const improved = variant === "improved";

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
                            <View style={[styles.categoryDot, { backgroundColor: palette.blue }]} />
                            <Text style={[styles.headerCategory, { color: palette.secondary }]}>개인</Text>
                        </View>
                    ) : (
                        <View style={styles.currentKindRow}>
                            <Ionicons name="calendar-clear-outline" size={12} color={palette.blue} />
                            <Text style={[styles.currentKindText, { color: palette.blue }]}>일정</Text>
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

            {!improved ? <View
                style={[
                    styles.currentRouteBar,
                    { borderTopColor: palette.border },
                ]}
            >
                <Ionicons name="navigate-outline" size={14} color={palette.blue} />
                <Text
                    style={[styles.currentRouteBarText, { color: palette.text }]}
                    numberOfLines={1}
                >
                    서울역 → 강남역
                </Text>
                <Text style={[styles.routeMetaText, { color: palette.secondary }]}>대중교통 · 36분</Text>
            </View> : null}
        </View>
    );
}

function MapControls({
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
    const improved = variant === "improved";

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
                    <Ionicons name="document-text-outline" size={16} color={palette.blue} />
                    <Text style={[styles.mapPillText, { color: palette.text }]}>메모</Text>
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
                {!improved ? <Text style={[styles.mapPillText, { color: palette.text }]}>내 위치</Text> : null}
            </Pressable>
        </>
    );
}

function SheetHandle({
    expanded,
    palette,
    onPress,
}: {
    expanded: boolean;
    palette: PreviewPalette;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? "경로 상세 시트 접기" : "경로 상세 시트 펼치기"}
            accessibilityState={{ expanded }}
            onPress={onPress}
            style={styles.handleHitArea}
        >
            <View style={[styles.handle, { backgroundColor: palette.border }]} />
        </Pressable>
    );
}

function CurrentCompact({ palette }: { palette: PreviewPalette }) {
    return (
        <View style={styles.currentCompact}>
            <View>
                <View style={styles.smallLabelRow}>
                    <Ionicons name="time-outline" size={13} color="#F59E0B" />
                    <Text style={[styles.currentSmallLabel, { color: palette.secondary }]}>일정까지 남은 시간</Text>
                </View>
                <Text style={[styles.currentCountdown, { color: palette.text }]}>42분</Text>
            </View>
            <View style={styles.currentCompactTrailing}>
                <Text style={[styles.currentCompactDate, { color: palette.secondary }]}>8월 8일 · 오후 12:00</Text>
                <Ionicons name="chevron-up" size={18} color={palette.text} />
            </View>
            <View style={styles.currentStatusLine}>
                <Ionicons name="walk-outline" size={13} color={palette.blue} />
                <Text style={[styles.currentStatusText, { color: palette.secondary }]}>권장 출발 오전 11:24 · 18분 뒤 출발</Text>
            </View>
        </View>
    );
}

function Participants({ palette }: { palette: PreviewPalette }) {
    return (
        <View style={[styles.participantRow, { borderTopColor: palette.border }]}>
            <View style={styles.participantTitleRow}>
                <Ionicons name="people-outline" size={15} color={palette.secondary} />
                <Text style={[styles.participantTitle, { color: palette.text }]}>참여자 출발 현황</Text>
            </View>
            <View style={styles.participantMetaRow}>
                <View style={[styles.avatar, { backgroundColor: palette.blueSoft }]}>
                    <Text style={[styles.avatarText, { color: palette.blue }]}>나</Text>
                </View>
                <View style={[styles.avatar, { backgroundColor: palette.sheetMuted }]}>
                    <Text style={[styles.avatarText, { color: palette.secondary }]}>민</Text>
                </View>
                <Text style={[styles.participantMeta, { color: palette.secondary }]}>1명 출발</Text>
                <Ionicons name="chevron-down" size={15} color={palette.tertiary} />
            </View>
        </View>
    );
}

function ProgressBar({ palette }: { palette: PreviewPalette }) {
    return (
        <View style={styles.progressWrap}>
            <View style={[styles.progressPiece, styles.progressWalkStart, { backgroundColor: palette.tertiary }]} />
            <View style={[styles.progressPiece, styles.progressLine4, { backgroundColor: LINE_4 }]} />
            <View style={[styles.progressPiece, styles.progressLine2, { backgroundColor: LINE_2 }]} />
            <View style={[styles.progressPiece, styles.progressWalkEnd, { backgroundColor: palette.tertiary }]} />
        </View>
    );
}

function CurrentExpanded({
    palette,
    departed,
    onDeparture,
}: {
    palette: PreviewPalette;
    departed: boolean;
    onDeparture: () => void;
}) {
    return (
        <ScrollView
            contentContainerStyle={styles.currentExpandedContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
        >
            <View style={[styles.currentStatusSection, { borderBottomColor: palette.border }]}>
                <View style={styles.currentStatusTopRow}>
                    <View>
                        <View style={styles.smallLabelRow}>
                            <Ionicons name="time-outline" size={13} color="#F59E0B" />
                            <Text style={[styles.currentSmallLabel, { color: palette.secondary }]}>일정까지 남은 시간</Text>
                        </View>
                        <Text style={[styles.currentHeroValue, { color: palette.text }]}>42분</Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="출발 알리기"
                        onPress={onDeparture}
                        style={[styles.currentDepartureButton, { backgroundColor: palette.blueSoft }]}
                    >
                        <Text style={[styles.currentDepartureButtonText, { color: palette.blue }]}>
                            {departed ? "출발 완료" : "출발 알리기"}
                        </Text>
                    </Pressable>
                </View>
                <Text style={[styles.currentDateText, { color: palette.secondary }]}>8월 8일 토요일 · 오후 12:00</Text>
                <Text style={[styles.currentDepartureHint, { color: palette.secondary }]}>권장 출발 오전 11:24 · 18분 뒤 출발</Text>
                <Participants palette={palette} />
            </View>

            <View style={[styles.currentRouteSection, { borderBottomColor: palette.border }]}>
                <View style={styles.currentRouteTop}>
                    <View>
                        <View style={styles.currentLiveRow}>
                            <View style={[styles.liveDot, { backgroundColor: palette.green }]} />
                            <Text style={[styles.currentRouteMeta, { color: palette.secondary }]}>실시간 교통 반영</Text>
                        </View>
                        <Text style={[styles.currentRouteTitle, { color: palette.text }]}>최적 경로</Text>
                    </View>
                    <View style={styles.currentRouteDurationRow}>
                        <Text style={[styles.currentRouteDuration, { color: palette.text }]}>36분</Text>
                        <View style={styles.currentMapIconButton}>
                            <Ionicons name="map-outline" size={21} color={palette.text} />
                        </View>
                    </View>
                </View>
                <ProgressBar palette={palette} />
            </View>

            <View style={styles.currentTimelineHeader}>
                <Text style={[styles.currentTimelineTitle, { color: palette.text }]}>경로 상세</Text>
                <Text style={[styles.currentTimelineTime, { color: palette.secondary }]}>오전 11:24 출발 기준</Text>
            </View>
            <View style={styles.currentMiniTimeline}>
                <Ionicons name="walk-outline" size={17} color={palette.secondary} />
                <Text style={[styles.currentMiniTimelineText, { color: palette.text }]}>서울역까지 도보 5분</Text>
                <Text style={[styles.currentMiniTimelineMeta, { color: palette.secondary }]}>340m</Text>
            </View>
            <View style={styles.currentMiniTimeline}>
                <View style={[styles.currentLineBadge, { backgroundColor: LINE_4 }]}>
                    <Text style={styles.currentLineBadgeText}>4</Text>
                </View>
                <Text style={[styles.currentMiniTimelineText, { color: palette.text }]}>서울역 → 사당역</Text>
                <Text style={[styles.currentMiniTimelineMeta, { color: palette.secondary }]}>23분</Text>
            </View>
        </ScrollView>
    );
}

function ImprovedCompact({
    palette,
    departed,
    onDeparture,
}: {
    palette: PreviewPalette;
    departed: boolean;
    onDeparture: () => void;
}) {
    const actionContentColor = departed ? palette.blue : "#FFFFFF";

    return (
        <View style={styles.improvedCompact}>
            <View style={[styles.sheetRouteIdentity, styles.sheetRouteIdentityCompact]}>
                <Ionicons name="navigate-outline" size={14} color={palette.blue} />
                <Text
                    style={[styles.sheetRouteIdentityTitle, { color: palette.text }]}
                    numberOfLines={1}
                >
                    서울역 → 강남역
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={departed ? "출발 완료" : "출발했어요"}
                    accessibilityState={{ selected: departed }}
                    hitSlop={3}
                    onPress={onDeparture}
                    style={({ pressed }) => [
                        styles.compactDepartureAction,
                        { backgroundColor: departed ? palette.blueSoft : palette.blue },
                        pressed && styles.previewActionPressed,
                    ]}
                >
                    <Ionicons
                        name={departed ? "checkmark" : "navigate"}
                        size={14}
                        color={actionContentColor}
                    />
                    <Text style={[styles.compactDepartureActionText, { color: actionContentColor }]}>
                        {departed ? "출발 완료" : "출발했어요"}
                    </Text>
                </Pressable>
            </View>
            <View style={styles.improvedCompactTop}>
                <View>
                    <Text style={[styles.improvedEyebrow, { color: palette.blue }]}>권장 출발</Text>
                    <View style={styles.improvedTimeRow}>
                        <Text style={[styles.improvedCompactTime, { color: palette.text }]}>오전 11:24</Text>
                        <View style={[styles.timeLeftChip, { backgroundColor: palette.blueSoft }]}>
                            <Text style={[styles.timeLeftChipText, { color: palette.blue }]}>18분 남음</Text>
                        </View>
                    </View>
                </View>
                <Ionicons name="chevron-up" size={18} color={palette.secondary} />
            </View>
            <Text style={[styles.improvedArrivalLine, { color: palette.secondary }]}>
                오후 12:00 도착 · 총 36분 · 환승 1회
            </Text>
            <ProgressBar palette={palette} />
            {departed ? (
                <View style={styles.departedInline}>
                    <Ionicons name="checkmark-circle" size={15} color={palette.green} />
                    <Text style={[styles.departedInlineText, { color: palette.secondary }]}>출발 상태를 공유했어요</Text>
                </View>
            ) : (
                <Text style={[styles.improvedCompactFacts, { color: palette.secondary }]}>도보 620m · 교통비 1,550원</Text>
            )}
        </View>
    );
}

function ImprovedExpanded({
    palette,
    isDark,
    routeDetailInfo,
    routeProgressSegments,
    departed,
    selectedRouteStepId,
    infoExpanded,
    onDeparture,
    onSelectRouteStep,
    onToggleInfo,
}: {
    palette: PreviewPalette;
    isDark: boolean;
    routeDetailInfo: RouteInfo;
    routeProgressSegments: TransitRouteProgressSegment[];
    departed: boolean;
    selectedRouteStepId?: string;
    infoExpanded: boolean;
    onDeparture: () => void;
    onSelectRouteStep: (step: RouteStep) => void;
    onToggleInfo: () => void;
}) {
    const departureTextColor = departed ? palette.blue : "#FFFFFF";
    const [nudgeSent, setNudgeSent] = useState(false);
    const sharedPeople = [
        { id: "me", avatar: "나", name: "나", status: "대기 중", departed: false, canNudge: false },
        { id: "minji", avatar: "민", name: "민지", status: "출발 완료", departed: true, canNudge: false },
        {
            id: "junho",
            avatar: "준",
            name: "준호",
            status: nudgeSent ? "알림 보냄" : "대기 중",
            departed: false,
            canNudge: true,
        },
    ];

    return (
        <ScrollView
            contentContainerStyle={styles.improvedExpandedContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
        >
            <View style={[styles.sheetRouteIdentity, styles.sheetRouteIdentityExpanded]}>
                <Ionicons name="navigate-outline" size={14} color={palette.blue} />
                <Text
                    style={[styles.sheetRouteIdentityTitle, { color: palette.text }]}
                    numberOfLines={1}
                >
                    서울역 → 강남역
                </Text>
                <Text style={[styles.sheetRouteIdentityMeta, { color: palette.secondary }]}>대중교통</Text>
            </View>
            <View style={[styles.improvedHero, { borderBottomColor: palette.border }]}>
                <View style={styles.improvedHeroTop}>
                    <View style={styles.improvedHeroCopy}>
                        <Text style={[styles.improvedEyebrow, { color: palette.blue }]}>권장 출발</Text>
                        <View style={styles.improvedTimeRow}>
                            <Text style={[styles.improvedHeroTime, { color: palette.text }]}>오전 11:24</Text>
                            <View style={[styles.timeLeftChip, { backgroundColor: palette.blueSoft }]}>
                                <Text style={[styles.timeLeftChipText, { color: palette.blue }]}>18분 남음</Text>
                            </View>
                        </View>
                        <Text style={[styles.improvedArrivalLine, { color: palette.secondary }]}>
                            오후 12:00 도착 · 총 36분
                        </Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={departed ? "출발 완료" : "출발했어요"}
                        accessibilityState={{ selected: departed }}
                        onPress={onDeparture}
                        style={[
                            styles.improvedDepartureButton,
                            { backgroundColor: departed ? palette.blueSoft : palette.blue },
                        ]}
                    >
                        <Ionicons
                            name={departed ? "checkmark" : "navigate"}
                            size={15}
                            color={departureTextColor}
                        />
                        <Text
                            style={[
                                styles.improvedDepartureButtonText,
                                { color: departureTextColor },
                            ]}
                        >
                            {departed ? "출발 완료" : "출발했어요"}
                        </Text>
                    </Pressable>
                </View>
                <View style={styles.improvedRouteFacts}>
                    <Text style={[styles.improvedRouteFact, { color: palette.secondary }]}>환승 1회</Text>
                    <View style={[styles.factDivider, { backgroundColor: palette.border }]} />
                    <Text style={[styles.improvedRouteFact, { color: palette.secondary }]}>도보 9분</Text>
                    <View style={[styles.factDivider, { backgroundColor: palette.border }]} />
                    <Text style={[styles.improvedRouteFact, { color: palette.secondary }]}>1,550원</Text>
                </View>
                <View style={styles.improvedExistingRouteBar}>
                    <TransitRouteProgressBar
                        segments={routeProgressSegments}
                        isDark={isDark}
                        compact
                    />
                </View>
            </View>

            <View style={[styles.sharedPeopleSection, { borderBottomColor: palette.border }]}>
                <View style={styles.sharedPeopleHeader}>
                    <View style={styles.sharedPeopleTitleRow}>
                        <Ionicons name="people-outline" size={16} color={palette.secondary} />
                        <Text style={[styles.sharedPeopleTitle, { color: palette.text }]}>함께하는 사람 3</Text>
                    </View>
                    <Text style={[styles.sharedPeopleSummary, { color: palette.secondary }]}>1/3 출발</Text>
                </View>
                <View style={styles.sharedPeopleRow}>
                    {sharedPeople.map((person) => {
                        const profile = (
                            <>
                                <View
                                    style={[
                                        styles.sharedPersonAvatar,
                                        {
                                            backgroundColor: person.departed
                                                ? palette.greenSoft
                                                : person.canNudge
                                                    ? palette.blueSoft
                                                    : palette.sheetMuted,
                                        },
                                        person.canNudge && { borderColor: palette.blue },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.sharedPersonAvatarText,
                                            {
                                                color: person.departed
                                                    ? palette.green
                                                    : person.canNudge
                                                        ? palette.blue
                                                        : palette.secondary,
                                            },
                                        ]}
                                    >
                                        {person.avatar}
                                    </Text>
                                    {person.canNudge ? (
                                        <View style={[styles.sharedPersonBell, { backgroundColor: palette.blue }]}>
                                            <Ionicons
                                                name={nudgeSent ? "checkmark" : "notifications"}
                                                size={8}
                                                color="#FFFFFF"
                                            />
                                        </View>
                                    ) : null}
                                </View>
                                <View style={styles.sharedPersonCopy}>
                                    <Text numberOfLines={1} style={[styles.sharedPersonName, { color: palette.text }]}>
                                        {person.name}
                                    </Text>
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.sharedPersonStatus,
                                            {
                                                color: person.departed
                                                    ? palette.green
                                                    : person.canNudge
                                                        ? palette.blue
                                                        : palette.secondary,
                                            },
                                        ]}
                                    >
                                        {person.status}
                                    </Text>
                                </View>
                            </>
                        );

                        return person.canNudge ? (
                            <Pressable
                                key={person.id}
                                accessibilityRole="button"
                                accessibilityLabel={nudgeSent
                                    ? `${person.name}에게 출발 확인 알림을 보냈어요`
                                    : `${person.name}에게 출발 확인 알림 보내기`}
                                accessibilityState={{ selected: nudgeSent }}
                                onPress={() => setNudgeSent(true)}
                                style={({ pressed }) => [
                                    styles.sharedPerson,
                                    pressed && styles.previewActionPressed,
                                ]}
                            >
                                {profile}
                            </Pressable>
                        ) : (
                            <View
                                key={person.id}
                                accessible
                                accessibilityLabel={`${person.name}, ${person.status}`}
                                style={styles.sharedPerson}
                            >
                                {profile}
                            </View>
                        );
                    })}
                </View>
            </View>

            <View style={[styles.improvedTimelineHeader, { borderBottomColor: palette.border }]}>
                <Text style={[styles.improvedSectionTitle, { color: palette.text }]}>경로 상세</Text>
                <Text style={[styles.improvedSectionMeta, { color: palette.secondary }]}>오전 11:24 출발 기준</Text>
            </View>
            <RouteStepTimeline
                routeInfo={routeDetailInfo}
                selectedStepId={selectedRouteStepId}
                onStepPress={onSelectRouteStep}
                forceDark={isDark}
                primaryTextColor={palette.text}
                secondaryTextColor={palette.secondary}
                compact
                realtimeArrivalsEnabled={false}
            />

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="일정 정보"
                accessibilityState={{ expanded: infoExpanded }}
                onPress={onToggleInfo}
                style={[styles.scheduleInfoDisclosure, { borderTopColor: palette.border }]}
            >
                <View style={styles.scheduleInfoTitleRow}>
                    <Ionicons name="calendar-outline" size={17} color={palette.secondary} />
                    <Text style={[styles.scheduleInfoTitle, { color: palette.text }]}>일정 정보</Text>
                </View>
                <Text style={[styles.scheduleInfoSummary, { color: palette.secondary }]}>알람 · 메모 있음</Text>
                <Ionicons
                    name={infoExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={palette.tertiary}
                />
            </Pressable>
            {infoExpanded ? (
                <View style={[styles.scheduleInfoBody, { backgroundColor: palette.sheetMuted }]}>
                    <Text style={[styles.scheduleInfoBodyText, { color: palette.secondary }]}>출발 알람 · 오전 11:24</Text>
                    <Text style={[styles.scheduleInfoBodyText, { color: palette.secondary }]}>2번 출구 앞에서 만나기</Text>
                </View>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="저장된 경로 수정" style={styles.routeEditButton}>
                <Text style={[styles.routeEditButtonText, { color: palette.blue }]}>경로 수정</Text>
            </Pressable>
        </ScrollView>
    );
}

export default function RouteDetailDesignPreview({
    variant,
    initialSheetMode = "expanded",
    routeDetailInfo,
    routeProgressSegments,
}: Props) {
    const { mode } = useTheme();
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const isDark = mode === "dark";
    const palette = useMemo(() => buildPalette(isDark), [isDark]);
    const [sheetMode, setSheetMode] = useState<RouteDetailPreviewSheetMode>(initialSheetMode);
    const [departed, setDeparted] = useState(false);
    const [selectedLeg, setSelectedLeg] = useState<string | null>(null);
    const [selectedRouteStepId, setSelectedRouteStepId] = useState<string>();
    const [infoExpanded, setInfoExpanded] = useState(false);
    const expanded = sheetMode === "expanded";
    const sheetHeight = expanded
        ? Math.min(variant === "improved" ? 558 : 574, Math.round(height * (variant === "improved" ? 0.64 : 0.66)))
        : variant === "improved" ? 224 + insets.bottom : 178 + insets.bottom;

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <RouteMap palette={palette} selectedLeg={selectedLeg} />
            <PreviewHeader variant={variant} palette={palette} topInset={insets.top} />
            <MapControls
                variant={variant}
                palette={palette}
                sheetHeight={sheetHeight}
                onShowAll={() => {
                    setSelectedLeg(null);
                    setSelectedRouteStepId(undefined);
                }}
            />

            <View
                style={[
                    styles.sheet,
                    {
                        height: sheetHeight,
                        paddingBottom: insets.bottom,
                        backgroundColor: variant === "current" ? palette.background : palette.sheet,
                        borderColor: palette.border,
                    },
                ]}
            >
                <SheetHandle
                    expanded={expanded}
                    palette={palette}
                    onPress={() => setSheetMode(expanded ? "compact" : "expanded")}
                />
                {variant === "current" ? (
                    expanded ? (
                        <CurrentExpanded
                            palette={palette}
                            departed={departed}
                            onDeparture={() => setDeparted((value) => !value)}
                        />
                    ) : (
                        <CurrentCompact palette={palette} />
                    )
                ) : expanded ? (
                    <ImprovedExpanded
                        palette={palette}
                        isDark={isDark}
                        routeDetailInfo={routeDetailInfo}
                        routeProgressSegments={routeProgressSegments}
                        departed={departed}
                        selectedRouteStepId={selectedRouteStepId}
                        infoExpanded={infoExpanded}
                        onDeparture={() => setDeparted((value) => !value)}
                        onSelectRouteStep={(step) => {
                            const nextSelectedStepId = selectedRouteStepId === step.id
                                ? undefined
                                : step.id;
                            setSelectedRouteStepId(nextSelectedStepId);
                            setSelectedLeg(nextSelectedStepId
                                ? step.type === "SUBWAY" || step.type === "BUS"
                                    ? step.badgeText ?? step.lineName ?? null
                                    : step.type === "WALK"
                                        ? "도보"
                                        : null
                                : null);
                        }}
                        onToggleInfo={() => setInfoExpanded((value) => !value)}
                    />
                ) : (
                    <ImprovedCompact
                        palette={palette}
                        departed={departed}
                        onDeparture={() => setDeparted((value) => !value)}
                    />
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, overflow: "hidden" },
    mapRoadEdge: { position: "absolute", justifyContent: "center" },
    mapRoadEdgeMajor: { height: 12, borderRadius: 6 },
    mapRoadEdgeMinor: { height: 7, borderRadius: 4 },
    mapRoad: { marginHorizontal: 1 },
    mapRoadMajor: { height: 9, borderRadius: 5 },
    mapRoadMinor: { height: 5, borderRadius: 3 },
    mapPark: {
        position: "absolute",
        right: -30,
        top: 124,
        width: 180,
        height: 126,
        borderRadius: 48,
        transform: [{ rotate: "-8deg" }],
    },
    mapDistrict: { position: "absolute", fontSize: 10, fontWeight: "600", letterSpacing: 0.3 },
    mapDistrictYongsan: { left: 26, top: 162 },
    mapDistrictSeocho: { right: 28, top: 226 },
    mapDistrictGangnam: { right: 44, top: 328 },
    mapRouteLine: { position: "absolute", height: 5, borderRadius: 3 },
    mapPinWrap: { position: "absolute", alignItems: "center" },
    mapPinLabel: {
        minHeight: 25,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000000",
        shadowOpacity: 0.10,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
    },
    mapPinLabelText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
    mapPin: {
        width: 22,
        height: 22,
        marginTop: 3,
        borderRadius: 11,
        borderWidth: 3,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000000",
        shadowOpacity: 0.16,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
    selectedMapLeg: {
        position: "absolute",
        left: 20,
        top: 138,
        height: 32,
        paddingHorizontal: 11,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    selectedMapLegDot: { width: 7, height: 7, borderRadius: 4 },
    selectedMapLegText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
    header: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        shadowColor: "#000000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
    },
    headerMainRow: { height: 56, paddingHorizontal: 10, flexDirection: "row", alignItems: "center" },
    headerIconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    headerTitleArea: { flex: 1, minWidth: 0, paddingHorizontal: 2 },
    headerActionRow: { flexDirection: "row", alignItems: "center" },
    headerCategoryRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 1 },
    categoryDot: { width: 7, height: 7, borderRadius: 4 },
    headerCategory: { fontSize: 10, lineHeight: 13, fontWeight: "600" },
    improvedHeaderTitle: { fontSize: 16, lineHeight: 21, fontWeight: "700", letterSpacing: -0.2 },
    currentKindRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    currentKindText: { fontSize: 10, lineHeight: 13, fontWeight: "800" },
    currentHeaderTitle: { marginTop: 1, fontSize: 16, lineHeight: 21, fontWeight: "900" },
    currentRouteBar: {
        height: 56,
        marginHorizontal: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    currentRouteBarText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: "900" },
    routeMetaText: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
    currentMemoButton: {
        position: "absolute",
        left: 16,
        zIndex: 9,
        height: 42,
        paddingHorizontal: 13,
        borderRadius: 21,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        shadowColor: "#000000",
        shadowOpacity: 0.10,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 3 },
    },
    currentLocationButton: {
        position: "absolute",
        right: 16,
        zIndex: 9,
        height: 42,
        paddingHorizontal: 13,
        borderRadius: 21,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        shadowColor: "#000000",
        shadowOpacity: 0.10,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 3 },
    },
    improvedMapButton: {
        position: "absolute",
        right: 16,
        zIndex: 9,
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000000",
        shadowOpacity: 0.10,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 3 },
    },
    mapPillText: { fontSize: 11, lineHeight: 15, fontWeight: "800" },
    sheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 12,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        borderWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: 0,
        overflow: "hidden",
        shadowColor: "#000000",
        shadowOpacity: 0.13,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: -5 },
    },
    handleHitArea: { height: 44, alignItems: "center", justifyContent: "center" },
    handle: { width: 34, height: 4, borderRadius: 2 },
    currentCompact: { flex: 1, paddingHorizontal: 20 },
    smallLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    currentSmallLabel: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
    currentCountdown: { marginTop: 1, fontSize: 24, lineHeight: 29, fontWeight: "900" },
    currentCompactTrailing: { position: "absolute", right: 20, top: 10, alignItems: "flex-end", gap: 8 },
    currentCompactDate: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
    currentStatusLine: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 5 },
    currentStatusText: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
    currentExpandedContent: { paddingHorizontal: 20, paddingBottom: 22 },
    currentStatusSection: { paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    currentStatusTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    currentHeroValue: { marginTop: 2, fontSize: 28, lineHeight: 34, fontWeight: "900" },
    currentDepartureButton: { minWidth: 96, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 13 },
    currentDepartureButtonText: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
    currentDateText: { marginTop: 3, fontSize: 11, lineHeight: 15, fontWeight: "700" },
    currentDepartureHint: { marginTop: 5, fontSize: 11, lineHeight: 15, fontWeight: "800" },
    participantRow: { minHeight: 48, marginTop: 10, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    participantTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    participantTitle: { fontSize: 11, lineHeight: 15, fontWeight: "800" },
    participantMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    avatar: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", marginLeft: -7 },
    avatarText: { fontSize: 9, lineHeight: 12, fontWeight: "900" },
    participantMeta: { marginLeft: 3, fontSize: 10, lineHeight: 14, fontWeight: "700" },
    currentRouteSection: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
    currentRouteTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    currentLiveRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    liveDot: { width: 6, height: 6, borderRadius: 3 },
    currentRouteMeta: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
    currentRouteTitle: { marginTop: 2, fontSize: 18, lineHeight: 23, fontWeight: "900" },
    currentRouteDurationRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    currentRouteDuration: { fontSize: 26, lineHeight: 31, fontWeight: "900" },
    currentMapIconButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
    progressWrap: { height: 6, marginTop: 12, borderRadius: 3, flexDirection: "row", gap: 2, overflow: "hidden" },
    progressPiece: { height: 6, borderRadius: 3 },
    progressWalkStart: { flex: 0.5 },
    progressLine4: { flex: 3.2 },
    progressLine2: { flex: 2.2 },
    progressWalkEnd: { flex: 0.4 },
    currentTimelineHeader: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    currentTimelineTitle: { fontSize: 13, lineHeight: 18, fontWeight: "900" },
    currentTimelineTime: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
    currentMiniTimeline: { minHeight: 52, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 10 },
    currentMiniTimelineText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: "800" },
    currentMiniTimelineMeta: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
    currentLineBadge: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    currentLineBadgeText: { color: "#FFFFFF", fontSize: 10, lineHeight: 13, fontWeight: "900" },
    improvedCompact: { flex: 1, paddingHorizontal: 20 },
    sheetRouteIdentity: { minHeight: 31, flexDirection: "row", alignItems: "center", gap: 6 },
    sheetRouteIdentityCompact: { minHeight: 44, gap: 8 },
    sheetRouteIdentityExpanded: { marginTop: -3, marginBottom: 3 },
    sheetRouteIdentityTitle: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, fontWeight: "700" },
    sheetRouteIdentityMeta: { fontSize: 11, lineHeight: 15, fontWeight: "500" },
    compactDepartureAction: {
        height: 38,
        paddingHorizontal: 11,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    compactDepartureActionText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
    improvedCompactTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    improvedEyebrow: { fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: -0.1 },
    improvedTimeRow: { marginTop: 1, flexDirection: "row", alignItems: "center", gap: 8 },
    improvedCompactTime: { fontSize: 25, lineHeight: 31, fontWeight: "800", letterSpacing: -0.5 },
    improvedHeroTime: { fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.6 },
    timeLeftChip: { minHeight: 25, paddingHorizontal: 9, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    timeLeftChipText: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
    improvedArrivalLine: { marginTop: 4, fontSize: 12, lineHeight: 17, fontWeight: "500" },
    improvedCompactFacts: { marginTop: 8, fontSize: 11, lineHeight: 15, fontWeight: "500" },
    previewActionPressed: { opacity: 0.65 },
    departedInline: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 5 },
    departedInlineText: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
    improvedExpandedContent: { paddingHorizontal: 20, paddingBottom: 24 },
    improvedHero: { paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
    improvedHeroTop: { flexDirection: "row", alignItems: "center", gap: 12 },
    improvedHeroCopy: { flex: 1, minWidth: 0 },
    improvedDepartureButton: { minWidth: 100, height: 44, paddingHorizontal: 13, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
    improvedDepartureButtonText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
    improvedRouteFacts: { marginTop: 13, flexDirection: "row", alignItems: "center", gap: 8 },
    improvedRouteFact: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
    factDivider: { width: 1, height: 11 },
    improvedExistingRouteBar: { marginTop: 12 },
    sharedPeopleSection: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
    sharedPeopleHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sharedPeopleTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    sharedPeopleTitle: { fontSize: 13, lineHeight: 18, fontWeight: "700", letterSpacing: -0.1 },
    sharedPeopleSummary: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
    sharedPeopleRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
    sharedPerson: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
    sharedPersonAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
    },
    sharedPersonAvatarText: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
    sharedPersonBell: {
        position: "absolute",
        right: -3,
        bottom: -2,
        width: 14,
        height: 14,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
    },
    sharedPersonCopy: { flex: 1, minWidth: 0 },
    sharedPersonName: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
    sharedPersonStatus: { marginTop: 1, fontSize: 9, lineHeight: 13, fontWeight: "600" },
    improvedTimelineHeader: {
        minHeight: 38,
        marginTop: 12,
        paddingHorizontal: 2,
        paddingBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    improvedSectionTitle: { fontSize: 13, lineHeight: 18, fontWeight: "900", letterSpacing: 0 },
    improvedSectionMeta: { flexShrink: 1, fontSize: 10, lineHeight: 14, fontWeight: "800", textAlign: "right" },
    scheduleInfoDisclosure: { minHeight: 54, marginTop: 8, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 8 },
    scheduleInfoTitleRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
    scheduleInfoTitle: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
    scheduleInfoSummary: { fontSize: 11, lineHeight: 15, fontWeight: "500" },
    scheduleInfoBody: { marginBottom: 8, padding: 12, borderRadius: 12, gap: 5 },
    scheduleInfoBodyText: { fontSize: 11, lineHeight: 16, fontWeight: "500" },
    routeEditButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
    routeEditButtonText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
});
