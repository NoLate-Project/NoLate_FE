import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, Text, TextInput, View } from "react-native";

import CalendarGlassSurface from "../src/modules/schedule/components/calendar/CalendarGlassSurface";
import ProfileRouteAccessibilityRoot from "../src/modules/profile/ProfileRouteAccessibilityRoot";
import ThemeModeSwitch from "../src/modules/theme/ThemeModeSwitch";
import BrandedLoader from "../src/ui/BrandedLoader";
import { AccountInfoRow, CalendarConnectionStat, ProfileLoadingView } from "./ProfileComponents";
import styles from "./profile.styles";
import { formatConnectionDate } from "./profilePresentation";
import { useProfileScreen } from "./useProfileScreen";

/** 프로필 정보와 계정·캘린더·앱 설정을 섹션별로 표시하는 화면입니다. */
export default function ProfileScreen() {
    const {
        insets, colors, mode, profile, account, calendarConnection, calendarConnectionError, signingOut, withdrawing, loadingProfile, editingProfile, setEditingProfile, savingProfile, draftName, setDraftName, memberIdCopied, profileError, withdrawalModalOpen, setWithdrawalModalOpen, withdrawalPassword, setWithdrawalPassword, passwordModalOpen, setPasswordModalOpen, currentPassword, setCurrentPassword, newPassword, setNewPassword, confirmPassword, setConfirmPassword, savingPassword, hasOpenModal, displayAccountName, isNaverAccount, displayEmail, displayLoginType, displayMemberId, profileSummary, avatarInitial, loadProfile, openProfileEditor, copyMemberId, saveProfile, handleSignOut, handleWithdraw, confirmCommonWithdrawal, openPasswordChange, savePasswordChange, goBackToSchedule, openCalendarOnboarding, openPlacesSettings, openPrivacyPolicy, openTermsOfService,
    } = useProfileScreen();
    if (loadingProfile) return <ProfileLoadingView colors={colors} dark={mode === "dark"} />;

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
                        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>

                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>프로필</Text>

                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="표시 이름 수정"
                        accessibilityState={{ disabled: !profile?.memberId }}
                        disabled={!profile?.memberId}
                        onPress={openProfileEditor}
                        style={({ pressed }) => [
                            styles.backButton,
                            { opacity: !profile?.memberId ? 0.38 : pressed ? 0.55 : 1 },
                        ]}
                    >
                        <Ionicons name="pencil" size={19} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>

            </View>

            <ScrollView
                accessibilityElementsHidden={hasOpenModal}
                importantForAccessibility={hasOpenModal ? "no-hide-descendants" : "auto"}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 18) + 20 },
                ]}
            >
                <CalendarGlassSurface
                    variant="card"
                    tone="solidCard"
                    style={[
                        styles.profileCard,
                        { borderColor: colors.border },
                    ]}
                >
                    <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={[
                            styles.avatar,
                            mode === "dark" ? styles.avatarDark : styles.avatarLight,
                        ]}
                    >
                        <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            style={[
                                styles.avatarText,
                                mode === "dark" ? styles.avatarTextDark : styles.avatarTextLight,
                            ]}
                        >
                            {avatarInitial}
                        </Text>
                    </View>
                    <View style={styles.profileCardText}>
                        <Text
                            numberOfLines={1}
                            style={[styles.profileName, { color: colors.textPrimary }]}
                        >
                            {displayAccountName}
                        </Text>
                        <Text
                            numberOfLines={1}
                            style={[styles.profileMeta, { color: colors.textSecondary }]}
                        >
                            {profileSummary}
                        </Text>
                    </View>
                </CalendarGlassSurface>

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
                    animationType="fade"
                    transparent
                    visible={editingProfile}
                    onRequestClose={() => !savingProfile && setEditingProfile(false)}
                    accessibilityViewIsModal
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                        style={styles.modalRoot}
                    >
                        <Pressable
                            accessible={false}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            disabled={savingProfile}
                            onPress={() => setEditingProfile(false)}
                            style={styles.modalBackdrop}
                        />
                        <ScrollView
                            bounces={false}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            style={[
                                styles.editSheetScroll,
                                { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                            contentContainerStyle={styles.editSheetScrollContent}
                        >
                            <View style={styles.editSheetHeader}>
                                <View>
                                    <Text style={[styles.editSheetTitle, { color: colors.textPrimary }]}>표시 이름 수정</Text>
                                    <Text style={[styles.editSheetCaption, { color: colors.textSecondary }]}>프로필에 표시할 이름을 변경합니다.</Text>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="닫기"
                                    disabled={savingProfile}
                                    onPress={() => setEditingProfile(false)}
                                    style={styles.modalCloseButton}
                                >
                                    <Ionicons name="close" size={22} color={colors.textPrimary} />
                                </Pressable>
                            </View>

                            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>이름</Text>
                            <TextInput
                                accessibilityLabel="표시 이름"
                                autoCapitalize="none"
                                autoCorrect={false}
                                autoFocus
                                editable={!savingProfile}
                                maxLength={20}
                                onChangeText={setDraftName}
                                onSubmitEditing={saveProfile}
                                placeholder="표시할 이름"
                                placeholderTextColor={colors.textSecondary}
                                returnKeyType="done"
                                selectionColor={colors.textPrimary}
                                style={[
                                    styles.nameInput,
                                    { color: colors.textPrimary, borderColor: colors.border },
                                ]}
                                value={draftName}
                            />
                            <Text style={[styles.inputCounter, { color: colors.textSecondary }]}>{draftName.length}/20</Text>

                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: savingProfile, busy: savingProfile }}
                                disabled={savingProfile}
                                onPress={saveProfile}
                                style={({ pressed }) => [
                                    styles.saveButton,
                                    { opacity: savingProfile || pressed ? 0.65 : 1 },
                                ]}
                            >
                                {savingProfile ? (
                                    <ActivityIndicator color="#ffffff" />
                                ) : (
                                    <Text style={styles.saveButtonText}>저장</Text>
                                )}
                            </Pressable>
                        </ScrollView>
                    </KeyboardAvoidingView>
                </Modal>

                <Modal
                    animationType="fade"
                    transparent
                    visible={passwordModalOpen}
                    onRequestClose={() => !savingPassword && setPasswordModalOpen(false)}
                    accessibilityViewIsModal
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                        style={styles.modalRoot}
                    >
                        <Pressable
                            accessible={false}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            disabled={savingPassword}
                            onPress={() => setPasswordModalOpen(false)}
                            style={styles.modalBackdrop}
                        />
                        <ScrollView
                            bounces={false}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            style={[
                                styles.editSheetScroll,
                                { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                            contentContainerStyle={styles.editSheetScrollContent}
                        >
                            <View style={styles.editSheetHeader}>
                                <View>
                                    <Text style={[styles.editSheetTitle, { color: colors.textPrimary }]}>비밀번호 변경</Text>
                                    <Text style={[styles.editSheetCaption, { color: colors.textSecondary }]}>영문, 숫자, 특수문자를 포함한 8~16자로 입력해 주세요.</Text>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="닫기"
                                    disabled={savingPassword}
                                    onPress={() => setPasswordModalOpen(false)}
                                    style={styles.modalCloseButton}
                                >
                                    <Ionicons name="close" size={22} color={colors.textPrimary} />
                                </Pressable>
                            </View>
                            {[
                                {
                                    label: "현재 비밀번호",
                                    value: currentPassword,
                                    setter: setCurrentPassword,
                                    autoComplete: "current-password" as const,
                                    textContentType: "password" as const,
                                },
                                {
                                    label: "새 비밀번호",
                                    value: newPassword,
                                    setter: setNewPassword,
                                    autoComplete: "new-password" as const,
                                    textContentType: "newPassword" as const,
                                },
                                {
                                    label: "새 비밀번호 확인",
                                    value: confirmPassword,
                                    setter: setConfirmPassword,
                                    autoComplete: "new-password" as const,
                                    textContentType: "newPassword" as const,
                                },
                            ].map((field) => (
                                <View key={field.label}>
                                    <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>{field.label}</Text>
                                    <TextInput
                                        accessibilityLabel={field.label}
                                        autoCapitalize="none"
                                        autoComplete={field.autoComplete}
                                        autoCorrect={false}
                                        editable={!savingPassword}
                                        onChangeText={field.setter}
                                        secureTextEntry
                                        textContentType={field.textContentType}
                                        style={[styles.nameInput, { color: colors.textPrimary, borderColor: colors.border }]}
                                        value={field.value}
                                    />
                                </View>
                            ))}
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ disabled: savingPassword, busy: savingPassword }}
                                disabled={savingPassword}
                                onPress={savePasswordChange}
                                style={({ pressed }) => [styles.saveButton, { opacity: savingPassword || pressed ? 0.65 : 1 }]}
                            >
                                {savingPassword ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>변경하기</Text>}
                            </Pressable>
                        </ScrollView>
                    </KeyboardAvoidingView>
                </Modal>

                <Modal
                    animationType="fade"
                    transparent
                    visible={withdrawalModalOpen}
                    onRequestClose={() => !withdrawing && setWithdrawalModalOpen(false)}
                    accessibilityViewIsModal
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === "ios" ? "padding" : "height"}
                        style={styles.modalRoot}
                    >
                        <Pressable
                            accessible={false}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            disabled={withdrawing}
                            onPress={() => setWithdrawalModalOpen(false)}
                            style={styles.modalBackdrop}
                        />
                        <ScrollView
                            bounces={false}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            style={[
                                styles.editSheetScroll,
                                { backgroundColor: colors.background, borderColor: colors.border },
                            ]}
                            contentContainerStyle={styles.editSheetScrollContent}
                        >
                            <View style={styles.editSheetHeader}>
                                <View style={styles.destructiveHeaderText}>
                                    <Text style={[styles.editSheetTitle, { color: colors.textPrimary }]}>회원탈퇴</Text>
                                    <Text style={[styles.editSheetCaption, { color: colors.textSecondary }]}>계정과 저장된 일정이 삭제되며 되돌릴 수 없습니다.</Text>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="닫기"
                                    disabled={withdrawing}
                                    onPress={() => setWithdrawalModalOpen(false)}
                                    style={styles.modalCloseButton}
                                >
                                    <Ionicons name="close" size={22} color={colors.textPrimary} />
                                </Pressable>
                            </View>
                            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>현재 비밀번호</Text>
                            <TextInput
                                accessibilityLabel="회원탈퇴 확인 비밀번호"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!withdrawing}
                                onChangeText={setWithdrawalPassword}
                                placeholder="비밀번호 입력"
                                placeholderTextColor={colors.textSecondary}
                                secureTextEntry
                                textContentType="password"
                                style={[styles.nameInput, { color: colors.textPrimary, borderColor: colors.border }]}
                                value={withdrawalPassword}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{
                                    disabled: withdrawing || !withdrawalPassword,
                                    busy: withdrawing,
                                }}
                                disabled={withdrawing || !withdrawalPassword}
                                onPress={confirmCommonWithdrawal}
                                style={({ pressed }) => [
                                    styles.destructiveButton,
                                    { opacity: withdrawing || !withdrawalPassword || pressed ? 0.55 : 1 },
                                ]}
                            >
                                {withdrawing ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>확인하고 탈퇴하기</Text>}
                            </Pressable>
                        </ScrollView>
                    </KeyboardAvoidingView>
                </Modal>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>계정 정보</Text>
                    <CalendarGlassSurface
                        variant="card"
                        tone="solidCard"
                        style={[styles.accountCard, { borderColor: colors.border }]}
                    >
                        <AccountInfoRow
                            label="표시 이름"
                            value={displayAccountName}
                            colors={colors}
                            onPress={openProfileEditor}
                            actionLabel="수정"
                            actionIcon="chevron-forward"
                        />
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
                        />
                        <AccountInfoRow
                            label="로그인"
                            value={displayLoginType}
                            colors={colors}
                            showDivider={account?.loginType !== "COMMON"}
                        />
                        {account?.loginType === "COMMON" ? (
                            <AccountInfoRow
                                label="비밀번호"
                                value="안전하게 변경"
                                colors={colors}
                                showDivider={false}
                                onPress={openPasswordChange}
                                actionLabel="변경"
                                actionIcon="chevron-forward"
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
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>캘린더 연동</Text>
                    <CalendarGlassSurface
                        interactive={!calendarConnection}
                        variant="card"
                        tone="solidCard"
                        style={[styles.calendarConnectionCard, { borderColor: colors.border }]}
                    >
                        {calendarConnection ? (
                            <View style={styles.calendarConnectionContent}>
                                <View style={styles.calendarConnectionHeader}>
                                    <View style={[styles.calendarConnectionIcon, { backgroundColor: colors.selectedDayBg }]}>
                                        <Ionicons name="calendar-outline" size={21} color={colors.selectedDayText} />
                                    </View>
                                    <View style={styles.calendarConnectionTitleWrap}>
                                        <Text style={[styles.calendarConnectionTitle, { color: colors.textPrimary }]}>
                                            {calendarConnection.providerLabel}
                                        </Text>
                                        <Text style={[styles.calendarConnectionHint, { color: colors.textSecondary }]}>
                                            일정을 가져온 캘린더
                                        </Text>
                                    </View>
                                    <View style={styles.connectedBadge}>
                                        <Text style={styles.connectedBadgeText}>연동됨</Text>
                                    </View>
                                </View>
                                <View style={[styles.calendarStats, { borderTopColor: colors.border }]}>
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
                                </View>
                                {calendarConnection.calendarNames.length > 0 ? (
                                    <View style={styles.syncedCalendarList}>
                                        {calendarConnection.calendarNames.map((name) => (
                                            <View key={name} style={[styles.syncedCalendarPill, { borderColor: colors.border }]}>
                                                <Ionicons name="ellipse" size={7} color={colors.textSecondary} />
                                                <Text
                                                    numberOfLines={1}
                                                    style={[styles.syncedCalendarPillText, { color: colors.textPrimary }]}
                                                >
                                                    {name}
                                                </Text>
                                            </View>
                                        ))}
                                    </View>
                                ) : null}
                                <Text style={[styles.calendarConnectionFooter, { color: colors.textSecondary }]}>
                                    마지막 확인 {formatConnectionDate(calendarConnection.lastScannedAt)}
                                    {calendarConnection.lastImportedAt
                                        ? ` · 마지막 추가 ${formatConnectionDate(calendarConnection.lastImportedAt)}`
                                        : ""}
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="캘린더 연동 관리"
                                    accessibilityHint="연결할 캘린더를 다시 선택하거나 일정을 추가로 가져옵니다"
                                    onPress={openCalendarOnboarding}
                                    style={({ pressed }) => [
                                        styles.calendarManageButton,
                                        {
                                            borderColor: colors.border,
                                            backgroundColor: colors.inputBackground,
                                            opacity: pressed ? 0.62 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons name="settings-outline" size={17} color={colors.textPrimary} />
                                    <Text style={[styles.calendarManageButtonText, { color: colors.textPrimary }]}>연동 관리</Text>
                                    <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
                                </Pressable>
                            </View>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={calendarConnectionError
                                    ? "캘린더 연결 상태 다시 확인"
                                    : "캘린더 연결 설정"}
                                onPress={calendarConnectionError ? loadProfile : openCalendarOnboarding}
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
                                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
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
                                accessibilityRole="button"
                                accessibilityLabel="내 장소 관리"
                                accessibilityHint="기본주소와 즐겨찾기 카테고리를 관리합니다"
                                onPress={openPlacesSettings}
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
                                        <Text style={[styles.settingHint, { color: colors.textSecondary }]}>기본주소와 즐겨찾기 카테고리 관리</Text>
                                    </View>
                                </View>
                                <View
                                    accessibilityElementsHidden
                                    importantForAccessibility="no-hide-descendants"
                                >
                                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
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
                                accessibilityHint="캘린더, 위치, 알림 정보 처리 기준을 엽니다"
                                onPress={openPrivacyPolicy}
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
                                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
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
                                accessibilityHint="NoLate 서비스 이용 기준을 엽니다"
                                onPress={openTermsOfService}
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
                                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
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
                        onPress={handleSignOut}
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
                        onPress={handleWithdraw}
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
        </ProfileRouteAccessibilityRoot>
    );
}
