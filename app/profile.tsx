import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import React from "react";
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, Text, TextInput, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown, ReduceMotion } from "react-native-reanimated";

import CalendarGlassSurface from "../src/modules/schedule/components/calendar/CalendarGlassSurface";
import ProfileRouteAccessibilityRoot from "../src/modules/profile/ProfileRouteAccessibilityRoot";
import ThemeModeSwitch from "../src/modules/theme/ThemeModeSwitch";
import BrandedLoader from "../src/ui/BrandedLoader";
import { AccountInfoRow, CalendarConnectionStat, ProfileLoadingView } from "../src/routeSupport/ProfileComponents";
import ProfileAccountSheet from "../src/routeSupport/ProfileAccountSheet";
import styles from "../src/routeSupport/profile.styles";
import { formatConnectionDate } from "../src/routeSupport/profilePresentation";
import { useProfileScreen } from "../src/routeSupport/useProfileScreen";
import { useScreenFirstPaintPerformance } from "../src/modules/performance/useScreenFirstPaintPerformance";
import ScreenFirstPaintShell from "../src/modules/performance/ScreenFirstPaintShell";
import { useDeferredScreenContent } from "../src/modules/performance/useDeferredScreenContent";
import { usePreMountedSceneActivity } from "../src/modules/performance/preMountedSceneActivity";

const profileDetailEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const nameSheetBackdropEntry = FadeIn.duration(200).reduceMotion(ReduceMotion.System);
const nameSheetEntry = FadeInDown.duration(200)
    .withInitialValues({ transform: [{ translateY: 14 }] })
    .reduceMotion(ReduceMotion.System);

/** 프로필 정보와 계정·캘린더·앱 설정을 섹션별로 표시하는 화면입니다. */
export default function ProfileRoute() {
    useScreenFirstPaintPerformance('/profile');
    const contentReady = useDeferredScreenContent();
    if (!contentReady) {
        return (
            <ScreenFirstPaintShell
                title="프로필"
                backAccessibilityLabel="일정 목록으로 돌아가기"
                testID="profile-first-paint-shell"
            />
        );
    }
    return <ProfileScreen />;
}

export function ProfileScreen() {
    const { fontScale } = useWindowDimensions();
    const compactProfile = fontScale <= 1.35;
    const routeFocused = useIsFocused();
    const sceneActivity = usePreMountedSceneActivity();
    const profileVisible = sceneActivity ?? routeFocused;
    const {
        insets, colors, mode, profile, account, calendarConnection, calendarConnectionError, signingOut, withdrawing,
        loadingProfile, editingProfile, setEditingProfile, savingProfile, draftName, setDraftName, memberIdCopied, profileError,
        savedNameRevision, canSaveName,
        accountAction, accountActionError, passwords, passwordChanged, savingPassword, withdrawalNeedsPassword, withdrawalCommitted,
        openAccountAction, closeAccountAction, changeAccountPasswordField, confirmSignOut, confirmWithdrawal, savePasswordChange,
        hasOpenModal, displayAccountName, isNaverAccount, displayEmail, displayLoginType, displayMemberId, profileSummary, avatarInitial,
        loadProfile, openProfileEditor, copyMemberId, saveProfile, goBackToSchedule, openCalendarOnboarding, openPlacesSettings,
        openPrivacyPolicy, openTermsOfService, defaultOriginName,
    } = useProfileScreen(profileVisible);
    const [importHistoryExpanded, setImportHistoryExpanded] = React.useState(false);
    const privacyLink = React.useRef<View>(null);
    const termsLink = React.useRef<View>(null);
    const calendarImportLink = React.useRef<View>(null);
    const placesLink = React.useRef<View>(null);
    const returnFocus = React.useRef<typeof privacyLink | null>(null);
    const nameEditButton = React.useRef<View>(null);
    const nameInput = React.useRef<TextInput>(null);
    const nameEditorWasOpen = React.useRef(false);
    const [nameInputFocused, setNameInputFocused] = React.useState(false);
    const [revealedNameRevision, setRevealedNameRevision] = React.useState(0);
    const restoreNameEditorFocus = React.useCallback(() => {
        if (!compactProfile || !nameEditorWasOpen.current) return;
        nameEditorWasOpen.current = false;
        setNameInputFocused(false);
        setRevealedNameRevision(savedNameRevision);
        if (nameEditButton.current) AccessibilityInfo.sendAccessibilityEvent?.(nameEditButton.current, "focus");
    }, [compactProfile, savedNameRevision]);
    React.useEffect(() => {
        if (Platform.OS === "ios" || editingProfile || !nameEditorWasOpen.current) return;
        const frame = requestAnimationFrame(restoreNameEditorFocus);
        return () => cancelAnimationFrame(frame);
    }, [editingProfile, restoreNameEditorFocus]);
    React.useEffect(() => {
        if (!profileVisible || !returnFocus.current) return;
        const frame = requestAnimationFrame(() => {
            const target = returnFocus.current?.current;
            returnFocus.current = null;
            if (target) AccessibilityInfo.sendAccessibilityEvent(target, "focus");
        });
        return () => cancelAnimationFrame(frame);
    }, [profileVisible]);
    const passwordButton = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const signOutButton = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const withdrawalButton = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const accountEntry = React.useRef<typeof passwordButton | undefined>(undefined);
    const restoreAccountFocus = React.useCallback(() => {
        const button = accountEntry.current?.current;
        if (button) AccessibilityInfo.sendAccessibilityEvent?.(button, "focus");
        accountEntry.current = undefined;
    }, []);
    React.useEffect(() => {
        if (accountAction || Platform.OS === "ios" || !accountEntry.current) return;
        const frame = requestAnimationFrame(restoreAccountFocus);
        return () => cancelAnimationFrame(frame);
    }, [accountAction, restoreAccountFocus]);
    React.useEffect(() => {
        if (passwordChanged) AccessibilityInfo.announceForAccessibility("비밀번호를 변경했어요.");
    }, [passwordChanged]);
    if (loadingProfile && !account && !profile) {
        return <ProfileLoadingView colors={colors} dark={mode === "dark"} />;
    }
    const editName = (
        <Pressable
            ref={nameEditButton}
            accessibilityRole="button"
            accessibilityLabel="표시 이름 수정"
            accessibilityState={{ disabled: !profile?.memberId }}
            disabled={!profile?.memberId}
            onPress={() => {
                nameEditorWasOpen.current = compactProfile;
                openProfileEditor();
            }}
            style={({ pressed }) => [
                compactProfile ? styles.nameEditButton : styles.backButton,
                { opacity: !profile?.memberId ? 0.38 : pressed ? 0.55 : 1 },
            ]}
        >
            <Ionicons name="pencil-outline" size={19} color={colors.textPrimary} />
        </Pressable>
    );
    const nameRevision = compactProfile ? revealedNameRevision : savedNameRevision;
    const nameInputAccent = mode === "dark" ? "#8CB4FF" : "#2563EB";
    const disabledNameButton = compactProfile && !canSaveName && !savingProfile;
    const connectionIconBackground = compactProfile
        ? (mode === "dark" ? "#21314D" : "#EAF1FF")
        : colors.selectedDayBg;
    const connectionIconColor = compactProfile
        ? (mode === "dark" ? "#91B8FF" : "#2767E8")
        : colors.selectedDayText;
    const importActionTitle = compactProfile
        ? calendarConnection ? "일정 더 가져오기" : calendarConnectionError ? "다시 확인" : "일정 가져오기"
        : "연동 관리";
    const importAction = (
        <Pressable
            ref={calendarImportLink}
            accessibilityRole="button"
            accessibilityLabel={compactProfile ? importActionTitle : "캘린더 연동 관리"}
            accessibilityHint={calendarConnection ? "연결할 캘린더를 다시 선택하거나 일정을 추가로 가져옵니다" : undefined}
            onPress={calendarConnectionError && !calendarConnection ? loadProfile : () => {
                returnFocus.current = calendarImportLink;
                openCalendarOnboarding();
            }}
            style={({ pressed }) => [
                styles.calendarManageButton,
                compactProfile && styles.compactCalendarAction,
                { borderColor: colors.border, backgroundColor: colors.inputBackground, opacity: pressed ? 0.62 : 1 },
            ]}
        >
            {!compactProfile && <Ionicons name="settings-outline" size={17} color={colors.textPrimary} />}
            <Text style={[styles.calendarManageButtonText, { color: colors.textPrimary }]}>{importActionTitle}</Text>
            <Ionicons name="chevron-forward-outline" size={17} color={colors.textSecondary} />
        </Pressable>
    );
    const identity = (
        <>
            <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                    styles.avatar, compactProfile && styles.compactAvatar,
                    mode === "dark" ? styles.avatarDark : styles.avatarLight,
                ]}
            >
                <Text numberOfLines={1} adjustsFontSizeToFit style={[
                    styles.avatarText, compactProfile && styles.compactAvatarText,
                    mode === "dark" ? styles.avatarTextDark : styles.avatarTextLight,
                ]}>{avatarInitial}</Text>
            </View>
            <View style={styles.profileCardText}>
                <Animated.Text key={nameRevision} entering={nameRevision ? profileDetailEntry : undefined}
                    numberOfLines={1} style={[styles.profileName, { color: colors.textPrimary }]}>
                    {displayAccountName}
                </Animated.Text>
                <Text numberOfLines={1} style={[styles.profileMeta, { color: colors.textSecondary }]}>
                    {compactProfile ? (account?.loginType ? `${displayLoginType} 계정` : displayLoginType) : profileSummary}
                </Text>
            </View>
            {compactProfile && editName}
        </>
    );

    return (
        <ProfileRouteAccessibilityRoot style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View
                accessibilityElementsHidden={hasOpenModal}
                importantForAccessibility={hasOpenModal ? "no-hide-descendants" : "auto"}
                style={[styles.header, { paddingTop: insets.top + 8 }]}
            >
                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="일정 목록으로 돌아가기"
                        onPress={goBackToSchedule}
                        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>

                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>프로필</Text>

                {compactProfile ? <View style={styles.headerSpacer} /> : <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    {editName}
                </CalendarGlassSurface>}

            </View>

            <ScrollView
                accessibilityElementsHidden={hasOpenModal}
                importantForAccessibility={hasOpenModal ? "no-hide-descendants" : "auto"}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    compactProfile && styles.compactContent,
                    { paddingBottom: Math.max(insets.bottom, 18) + 20 },
                ]}
            >
                {compactProfile ? <View style={styles.compactIdentity}>{identity}</View> : <CalendarGlassSurface
                    variant="card"
                    tone="solidCard"
                    style={[
                        styles.profileCard,
                        { borderColor: colors.border },
                    ]}
                >
                    {identity}
                </CalendarGlassSurface>}

                {profileError ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="프로필 다시 불러오기"
                        onPress={loadProfile}
                        style={[styles.profileErrorCard, { borderColor: colors.border }]}
                    >
                        <Ionicons name="alert-circle-outline" size={19} color="#D97706" />
                        <View style={styles.profileErrorTextWrap}>
                            <Text style={[styles.profileErrorTitle, { color: colors.textPrimary }]}>일부 계정 정보를 불러오지 못했어요</Text>
                            <Text numberOfLines={2} style={[styles.profileErrorCaption, { color: colors.textSecondary }]}>{profileError}</Text>
                        </View>
                        <Text style={[styles.profileErrorRetry, { color: colors.textPrimary }]}>다시 시도</Text>
                    </Pressable>
                ) : null}

                <Modal
                    animationType={compactProfile ? "none" : "fade"}
                    transparent
                    visible={editingProfile}
                    onRequestClose={() => !savingProfile && setEditingProfile(false)}
                    onShow={() => {
                        if (compactProfile && nameInput.current) AccessibilityInfo.sendAccessibilityEvent?.(nameInput.current, "focus");
                    }}
                    onDismiss={restoreNameEditorFocus}
                    accessibilityViewIsModal
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                        style={styles.modalRoot}
                    >
                        <Animated.View entering={compactProfile ? nameSheetBackdropEntry : undefined} style={styles.modalBackdropPosition}>
                            <Pressable
                                accessible={false}
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                disabled={savingProfile}
                                onPress={() => setEditingProfile(false)}
                                style={styles.modalBackdrop}
                            />
                        </Animated.View>
                        <Animated.ScrollView
                            entering={compactProfile ? nameSheetEntry : undefined}
                            testID="profile-name-sheet"
                            accessibilityViewIsModal
                            bounces={false}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            style={[
                                styles.editSheetScroll,
                                compactProfile && styles.compactNameSheet,
                                { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                            contentContainerStyle={[styles.editSheetScrollContent, compactProfile && styles.compactNameSheetContent]}
                        >
                            {compactProfile && <View style={[styles.nameSheetHandle, { backgroundColor: colors.border }]} />}
                            <View style={styles.editSheetHeader}>
                                <View>
                                    <Text style={[styles.editSheetTitle, { color: colors.textPrimary }]}>표시 이름 수정</Text>
                                    {!compactProfile && <Text style={[styles.editSheetCaption, { color: colors.textSecondary }]}>프로필에 표시할 이름을 변경합니다.</Text>}
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="닫기"
                                    disabled={savingProfile}
                                    onPress={() => setEditingProfile(false)}
                                    style={[styles.modalCloseButton, compactProfile && styles.compactNameCloseButton]}
                                >
                                    <Ionicons name="close-outline" size={22} color={colors.textPrimary} />
                                </Pressable>
                            </View>

                            <Text style={[styles.inputLabel, compactProfile && styles.compactNameLabel, { color: colors.textSecondary }]}>이름</Text>
                            <TextInput
                                ref={nameInput}
                                accessibilityLabel="표시 이름"
                                autoCapitalize="none"
                                autoCorrect={false}
                                autoFocus={!compactProfile}
                                editable={!savingProfile}
                                maxLength={20}
                                onChangeText={setDraftName}
                                onFocus={() => setNameInputFocused(true)}
                                onBlur={() => setNameInputFocused(false)}
                                onSubmitEditing={saveProfile}
                                placeholder="표시할 이름"
                                placeholderTextColor={colors.textSecondary}
                                returnKeyType="done"
                                selectionColor={colors.textPrimary}
                                style={[
                                    styles.nameInput,
                                    { color: colors.textPrimary, borderColor: compactProfile && nameInputFocused ? nameInputAccent : colors.border },
                                ]}
                                value={draftName}
                            />
                            <Text style={[styles.inputCounter, { color: colors.textSecondary }]}>{draftName.length}/20</Text>

                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: savingProfile || !canSaveName, busy: savingProfile }}
                                disabled={savingProfile || !canSaveName}
                                onPress={saveProfile}
                                style={({ pressed }) => [
                                    styles.saveButton,
                                    disabledNameButton && { backgroundColor: mode === "dark" ? "#263651" : "#DCE6FA" },
                                    { opacity: !disabledNameButton && (savingProfile || !canSaveName || pressed) ? 0.65 : 1 },
                                ]}
                            >
                                {savingProfile ? (
                                    <ActivityIndicator color="#ffffff" />
                                ) : (
                                    <Text style={[styles.saveButtonText, disabledNameButton && { color: mode === "dark" ? "#B9C8E5" : "#526582" }]}>저장</Text>
                                )}
                            </Pressable>
                        </Animated.ScrollView>
                    </KeyboardAvoidingView>
                </Modal>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>계정 정보</Text>
                    <CalendarGlassSurface
                        variant="card"
                        tone="solidCard"
                        style={[styles.accountCard, { borderColor: colors.border }]}
                    >
                        {!compactProfile && <AccountInfoRow
                            label="표시 이름"
                            value={displayAccountName}
                            colors={colors}
                            onPress={openProfileEditor}
                            actionLabel="수정"
                            actionIcon="chevron-forward"
                        />}
                        {displayMemberId ? (
                            <AccountInfoRow
                                label="NoLate ID"
                                value={`#${displayMemberId}`}
                                colors={colors}
                                onPress={copyMemberId}
                                actionLabel={memberIdCopied ? "복사됨" : "복사"}
                                actionIcon={memberIdCopied ? "checkmark" : "copy-outline"}
                            />
                        ) : null}
                        <AccountInfoRow
                            label="이메일"
                            value={displayEmail}
                            colors={colors}
                            selectable
                            showDivider={!compactProfile || account?.loginType === "COMMON"}
                        />
                        {!compactProfile && <AccountInfoRow
                            label="로그인"
                            value={displayLoginType}
                            colors={colors}
                            showDivider={account?.loginType !== "COMMON"}
                        />}
                        {account?.loginType === "COMMON" ? (
                            <AccountInfoRow
                                label="비밀번호"
                                value={compactProfile ? undefined : "안전하게 변경"}
                                colors={colors}
                                showDivider={false}
                                buttonRef={passwordButton}
                                onPress={() => {
                                    accountEntry.current = passwordButton;
                                    openAccountAction("password");
                                }}
                                actionLabel="변경"
                                actionIcon="chevron-forward-outline"
                            />
                        ) : null}
                    </CalendarGlassSurface>
                </View>

                {isNaverAccount ? (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>네이버 계정 정보</Text>
                        <CalendarGlassSurface
                            variant="card"
                            tone="solidCard"
                            style={[styles.usageCard, { borderColor: colors.border }]}
                        >
                            <View style={styles.usageHeader}>
                                <View style={styles.naverBadge}>
                                    <Text style={styles.naverBadgeText}>N</Text>
                                </View>
                                <View style={styles.usageHeaderText}>
                                    <Text style={[styles.usageTitle, { color: colors.textPrimary }]}>NoLate에서 사용하는 정보</Text>
                                    <Text style={[styles.usageHint, { color: colors.textSecondary }]}>네이버 계정의 이름과 이메일을 사용하고 있어요.</Text>
                                </View>
                            </View>
                            <View style={[styles.usageDivider, { backgroundColor: colors.border }]} />
                            <Text style={[styles.usageItemTitle, { color: colors.textPrimary }]}>회원이름 · {displayAccountName}</Text>
                            <Text style={[styles.usageItemBody, { color: colors.textSecondary }]}>프로필에 표시</Text>
                            <Text style={[styles.usageItemTitle, styles.usageItemSpacing, { color: colors.textPrimary }]}>이메일 · {displayEmail}</Text>
                            <Text style={[styles.usageItemBody, { color: colors.textSecondary }]}>로그인 계정 확인에 사용</Text>
                        </CalendarGlassSurface>
                    </View>
                ) : null}

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{compactProfile ? "캘린더" : "캘린더 연동"}</Text>
                    <CalendarGlassSurface
                        interactive={!compactProfile && !calendarConnection}
                        variant="card"
                        tone="solidCard"
                        style={[styles.calendarConnectionCard, { borderColor: colors.border }]}
                    >
                        {calendarConnection ? (
                            <View style={[styles.calendarConnectionContent, compactProfile && styles.compactCalendarConnection]}>
                                <View style={styles.calendarConnectionHeader}>
                                    <View style={[styles.calendarConnectionIcon, { backgroundColor: connectionIconBackground }]}>
                                        <Ionicons name="calendar-outline" size={21} color={connectionIconColor} />
                                    </View>
                                    <View style={styles.calendarConnectionTitleWrap}>
                                        <Text style={[styles.calendarConnectionTitle, { color: colors.textPrimary }]}>
                                            {calendarConnection.providerLabel}
                                        </Text>
                                        <Text style={[styles.calendarConnectionHint, { color: colors.textSecondary }]}>
                                            {compactProfile ? `가져온 일정 ${calendarConnection.importedCount}개` : "일정을 가져온 캘린더"}
                                        </Text>
                                    </View>
                                    {!compactProfile && <View style={styles.connectedBadge}>
                                        <Text style={styles.connectedBadgeText}>연동됨</Text>
                                    </View>}
                                </View>
                                {compactProfile ? importAction : <View style={[styles.calendarStats, { borderTopColor: colors.border }]}>
                                    <CalendarConnectionStat
                                        label="캘린더"
                                        value={`${calendarConnection.calendarCount}개`}
                                    />
                                    <CalendarConnectionStat
                                        label="확인한 일정"
                                        value={`${calendarConnection.eventCandidateCount}개`}
                                    />
                                    <CalendarConnectionStat
                                        label="추가한 일정"
                                        value={`${calendarConnection.importedCount}개`}
                                    />
                                </View>}
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="가져오기 기록"
                                    accessibilityState={{ expanded: importHistoryExpanded }}
                                    onPress={() => setImportHistoryExpanded(expanded => !expanded)}
                                    style={[styles.calendarManageButton, compactProfile && styles.compactCalendarHistory, { borderColor: colors.border }]}
                                >
                                    {!compactProfile && <Ionicons name="time-outline" size={17} color={colors.textSecondary} />}
                                    <Text style={[styles.calendarManageButtonText, { color: colors.textPrimary }]}>가져오기 기록</Text>
                                    <Ionicons name={importHistoryExpanded ? "chevron-up-outline" : "chevron-down-outline"} size={17} color={colors.textSecondary} />
                                </Pressable>
                                {importHistoryExpanded && (
                                    <Animated.View entering={profileDetailEntry} style={styles.importHistory}>
                                        {compactProfile && !calendarConnection.importHistory?.length && (
                                            <View style={[styles.calendarStats, { borderTopColor: colors.border }]}>
                                                <CalendarConnectionStat label="확인한 캘린더" value={`${calendarConnection.calendarCount}개`} />
                                                <CalendarConnectionStat label="확인한 일정" value={`${calendarConnection.eventCandidateCount}개`} />
                                            </View>
                                        )}
                                        {calendarConnection.importHistory?.map((receipt, index) => (
                                            <View key={`${receipt.completedAt}-${index}`} style={[styles.importReceipt, { borderColor: colors.border }]}>
                                                <Text style={[styles.importReceiptTitle, { color: colors.textPrimary }]}>
                                                    {receipt.providerLabels.join(" · ") || calendarConnection.providerLabel}
                                                </Text>
                                                <Text style={[styles.calendarConnectionFooter, { color: colors.textSecondary }]}>
                                                    가져온 일정 {receipt.imported}개 · 중복 {receipt.duplicate}개 · 확인 필요 {receipt.failed}개
                                                </Text>
                                                <Text style={[styles.calendarConnectionFooter, { color: colors.textSecondary }]}>
                                                    {formatConnectionDate(receipt.completedAt)}
                                                </Text>
                                            </View>
                                        ))}
                                        {!!calendarConnection.calendarNames.length && <View style={styles.syncedCalendarList}>
                                            {calendarConnection.calendarNames.map((name) => (
                                                <View key={name} style={[styles.syncedCalendarPill, { borderColor: colors.border }]}>
                                                    <Ionicons name="ellipse" size={7} color={colors.textSecondary} />
                                                    <Text
                                                        style={[styles.syncedCalendarPillText, { color: colors.textPrimary }]}
                                                    >
                                                        {name}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>}
                                        <Text style={[styles.calendarConnectionFooter, { color: colors.textSecondary }]}>
                                            마지막 확인 {formatConnectionDate(calendarConnection.lastScannedAt)}
                                            {!calendarConnection.importHistory?.length && calendarConnection.lastImportedAt
                                                ? ` · 마지막 추가 ${formatConnectionDate(calendarConnection.lastImportedAt)}`
                                                : ""}
                                        </Text>
                                    </Animated.View>
                                )}
                                {!compactProfile && importAction}
                            </View>
                        ) : compactProfile ? (
                            <View style={[styles.calendarConnectionContent, styles.compactCalendarConnection]}>
                                <View style={styles.calendarConnectionHeader}>
                                    <View style={[styles.calendarConnectionIcon, { backgroundColor: connectionIconBackground }]}>
                                        <Ionicons name={calendarConnectionError ? "refresh-outline" : "calendar-outline"} size={21} color={connectionIconColor} />
                                    </View>
                                    <View style={styles.calendarConnectionTitleWrap}>
                                        <Text style={[styles.calendarConnectionTitle, { color: colors.textPrimary }]}>
                                            {calendarConnectionError ? "연결 상태를 확인하지 못했어요" : "연동된 캘린더 없음"}
                                        </Text>
                                        {!calendarConnectionError && (
                                            <Text style={[styles.calendarConnectionHint, { color: colors.textSecondary }]}>
                                                휴대폰 캘린더나 Google Calendar의 일정을 추가할 수 있어요
                                            </Text>
                                        )}
                                    </View>
                                </View>
                                {importAction}
                            </View>
                        ) : (
                            <Pressable
                                ref={calendarImportLink}
                                accessibilityRole="button"
                                accessibilityLabel={calendarConnectionError
                                    ? "캘린더 연결 상태 다시 확인"
                                    : "캘린더 연결 설정"}
                                onPress={calendarConnectionError ? loadProfile : () => { returnFocus.current = calendarImportLink; openCalendarOnboarding(); }}
                                style={({ pressed }) => [
                                    styles.calendarEmptyButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={[styles.calendarConnectionIcon, { backgroundColor: colors.selectedDayBg }]}>
                                    <Ionicons
                                        name={calendarConnectionError ? "refresh-outline" : "calendar-outline"}
                                        size={21}
                                        color={colors.selectedDayText}
                                    />
                                </View>
                                <View style={styles.calendarConnectionTitleWrap}>
                                    <Text style={[styles.calendarConnectionTitle, { color: colors.textPrimary }]}>
                                        {calendarConnectionError ? "연결 상태를 확인하지 못했어요" : "연동된 캘린더 없음"}
                                    </Text>
                                    <Text style={[styles.calendarConnectionHint, { color: colors.textSecondary }]}>
                                        {calendarConnectionError
                                            ? "탭해서 다시 확인해 주세요"
                                            : "휴대폰 캘린더나 Google Calendar의 일정을 추가할 수 있어요"}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward-outline" size={20} color={colors.textSecondary} />
                            </Pressable>
                        )}
                    </CalendarGlassSurface>
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>앱 설정</Text>
                    <View style={styles.settingsList}>
                        <CalendarGlassSurface
                            interactive
                            variant="card"
                            tone="solidCard"
                            style={[styles.legalCard, { borderColor: colors.border }]}
                        >
                            <Pressable
                                ref={placesLink}
                                accessibilityRole="button"
                                accessibilityLabel="내 장소 관리"
                                accessibilityValue={defaultOriginName ? { text: `기본주소 · ${defaultOriginName}` } : undefined}
                                accessibilityHint="기본주소와 즐겨찾기 카테고리를 관리합니다"
                                onPress={() => { returnFocus.current = placesLink; openPlacesSettings(); }}
                                style={({ pressed }) => [
                                    styles.legalButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={styles.appSettingRowContent}>
                                    <View style={[styles.appSettingIcon, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
                                        <Ionicons name="location-outline" size={20} color="#2563EB" />
                                    </View>
                                    <View style={styles.settingTextWrap}>
                                        <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>내 장소</Text>
                                        <Text style={[styles.settingHint, { color: colors.textSecondary }]}>
                                            {defaultOriginName ? `기본주소 · ${defaultOriginName}` : "기본주소와 즐겨찾기 카테고리 관리"}
                                        </Text>
                                    </View>
                                </View>
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Ionicons name="chevron-forward-outline" size={20} color={colors.textSecondary} />
                                </View>
                            </Pressable>
                        </CalendarGlassSurface>

                        <CalendarGlassSurface
                            variant="card"
                            tone="solidCard"
                            style={[styles.settingsCard, { borderColor: colors.border }]}
                        >
                            <View style={styles.settingTextWrap}>
                                <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>화면 테마</Text>
                                <Text style={[styles.settingHint, { color: colors.textSecondary }]}>시스템 설정을 따르거나 밝기를 직접 선택하세요</Text>
                            </View>
                            <View style={styles.settingSwitchWrap}>
                                <ThemeModeSwitch style={styles.settingSwitch} />
                            </View>
                        </CalendarGlassSurface>

                        <CalendarGlassSurface
                            interactive
                            variant="card"
                            tone="solidCard"
                            style={[styles.legalCard, { borderColor: colors.border }]}
                        >
                            <Pressable
                                accessibilityRole="link"
                                accessibilityLabel="개인정보처리방침"
                                ref={privacyLink}
                                accessibilityHint="캘린더, 위치, 알림 정보 처리 기준을 엽니다"
                                onPress={() => { returnFocus.current = privacyLink; openPrivacyPolicy(); }}
                                style={({ pressed }) => [
                                    styles.legalButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={styles.settingTextWrap}>
                                    <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>
                                        개인정보처리방침
                                    </Text>
                                    <Text style={[styles.settingHint, { color: colors.textSecondary }]}>
                                        캘린더, 위치, 알림 정보 처리 기준
                                    </Text>
                                </View>
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Ionicons name="chevron-forward-outline" size={20} color={colors.textSecondary} />
                                </View>
                            </Pressable>
                        </CalendarGlassSurface>

                        <CalendarGlassSurface
                            interactive
                            variant="card"
                            tone="solidCard"
                            style={[styles.legalCard, { borderColor: colors.border }]}
                        >
                            <Pressable
                                accessibilityRole="link"
                                accessibilityLabel="서비스 이용약관"
                                ref={termsLink}
                                accessibilityHint="NoLate 서비스 이용 기준을 엽니다"
                                onPress={() => { returnFocus.current = termsLink; openTermsOfService(); }}
                                style={({ pressed }) => [
                                    styles.legalButton,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={styles.settingTextWrap}>
                                    <Text
                                        style={[styles.settingTitle, { color: colors.textPrimary }]}
                                    >
                                        서비스 이용약관
                                    </Text>
                                    <Text
                                        style={[styles.settingHint, { color: colors.textSecondary }]}
                                    >
                                        NoLate 서비스 이용 기준
                                    </Text>
                                </View>
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Ionicons name="chevron-forward-outline" size={20} color={colors.textSecondary} />
                                </View>
                            </Pressable>
                        </CalendarGlassSurface>
                    </View>
                </View>

                <CalendarGlassSurface
                    interactive
                    variant="card"
                    tone="solidCard"
                    style={[styles.signOutGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={signingOut ? "로그아웃하고 있어요" : "로그아웃"}
                        accessibilityState={{ disabled: signingOut, busy: signingOut }}
                        disabled={signingOut}
                        ref={signOutButton}
                        onPress={() => {
                            accountEntry.current = signOutButton;
                            openAccountAction("logout");
                        }}
                        style={({ pressed }) => [
                            styles.signOutButton,
                            {
                                opacity: pressed || signingOut ? 0.58 : 1,
                            },
                        ]}
                    >
                        {signingOut ? (
                            <BrandedLoader
                                size="button"
                                variant="auth"
                                accessibilityLabel="로그아웃하고 있어요"
                            />
                        ) : (
                            <Ionicons name="log-out-outline" size={19} color="#ef4444" />
                        )}
                        <Text style={styles.signOutText}>
                            {signingOut ? "로그아웃 중" : "로그아웃"}
                        </Text>
                    </Pressable>
                </CalendarGlassSurface>

                <CalendarGlassSurface
                    interactive
                    variant="card"
                    tone="solidCard"
                    style={[styles.withdrawGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={withdrawing ? "회원탈퇴를 처리하고 있어요" : "회원탈퇴"}
                        accessibilityState={{ disabled: withdrawing || signingOut || !account?.loginType }}
                        disabled={withdrawing || signingOut || !account?.loginType}
                        ref={withdrawalButton}
                        onPress={() => {
                            accountEntry.current = withdrawalButton;
                            openAccountAction("withdraw");
                        }}
                        style={({ pressed }) => [
                            styles.signOutButton,
                            { opacity: pressed || withdrawing || signingOut || !account?.loginType ? 0.58 : 1 },
                        ]}
                    >
                        {withdrawing ? (
                            <BrandedLoader size="button" variant="auth" accessibilityLabel="회원탈퇴를 처리하고 있어요" />
                        ) : (
                            <Ionicons name="person-remove-outline" size={19} color={colors.textSecondary} />
                        )}
                        <Text style={[styles.withdrawText, { color: colors.textSecondary }]}>
                            {withdrawing ? "회원탈퇴 처리 중" : "회원탈퇴"}
                        </Text>
                    </Pressable>
                </CalendarGlassSurface>
            </ScrollView>
            {passwordChanged && (
                <View pointerEvents="none" style={[styles.accountNotice, { bottom: Math.max(insets.bottom, 16), backgroundColor: colors.surface2 }]}>
                    <Ionicons name="checkmark-circle-outline" size={19} color={colors.textPrimary} />
                    <Text style={[styles.accountNoticeText, { color: colors.textPrimary }]}>비밀번호를 변경했어요.</Text>
                </View>
            )}
            <ProfileAccountSheet
                action={accountAction}
                passwords={passwords}
                error={accountActionError}
                busy={savingPassword || signingOut || withdrawing}
                withdrawalNeedsPassword={withdrawalNeedsPassword}
                withdrawalCommitted={withdrawalCommitted}
                onChangeField={changeAccountPasswordField}
                onClose={closeAccountAction}
                onDismiss={restoreAccountFocus}
                onConfirm={accountAction === "password" ? savePasswordChange : accountAction === "logout" ? confirmSignOut : confirmWithdrawal}
            />
        </ProfileRouteAccessibilityRoot>
    );
}
