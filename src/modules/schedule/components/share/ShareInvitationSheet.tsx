import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Reanimated from "react-native-reanimated";

import BrandedLoader from "../../../../ui/BrandedLoader";
import { OptionChip } from "./ShareInvitationOptionChip";
import styles from "./ShareInvitationSheet.styles";
import { ACCEPT_COUNT_OPTIONS, PERMISSION_OPTIONS, SHEET_LAYOUT_TRANSITION, TTL_OPTIONS,
    formatExpiresAt, permissionLabel, statusLabel, type ShareInvitationSheetProps } from "./shareInvitationModel";
import { useShareInvitationSheet } from "./useShareInvitationSheet";

export { createShareInviteUrl } from "./shareInvitationModel";

/** 일정·카테고리·캘린더의 직접 공유와 링크 초대 UI를 표시합니다. */
export default function ShareInvitationSheet(props: ShareInvitationSheetProps) {
    const { visible, title, subtitle, onClose, resourceType } = props;
    const { insets, colors, highlight, isDark, resourceLabel, shareMode, permission, setPermission, contentMode, setContentMode, targetQuery, setTargetQuery, lastDirectShareLabel, setLastDirectShareLabel, ttlHours, setTtlHours, maxAcceptCount, setMaxAcceptCount, loading, generatedLink, directError, setDirectError, linkError, revokingInvitationId, latestInvitation, loadInvitations, shareGeneratedLink, createInvitation, createDirectShare, revokeInvitation, submitting, submitDisabled, modeIndicatorWidth, modeIndicatorTranslateX, modeContentAnimatedStyle, handleModeSegmentLayout, switchShareMode } = useShareInvitationSheet(props);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View style={styles.backdrop}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="공유 닫기"
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                />
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    pointerEvents="box-none"
                    style={styles.keyboardAvoidingView}
                >
                    <Reanimated.View
                        layout={SHEET_LAYOUT_TRANSITION}
                        style={[
                            styles.sheet,
                            {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                paddingBottom: Math.max(insets.bottom, 14) + 10,
                            },
                        ]}
                    >
                    <View style={styles.handleRow}>
                        <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    </View>

                    <View style={styles.header}>
                        <View style={[styles.resourceIcon, { backgroundColor: `${highlight}22` }]}>
                            <Ionicons
                                name={resourceType === "schedule"
                                    ? "calendar-outline"
                                    : resourceType === "calendar" ? "people-outline" : "folder-open-outline"}
                                size={22}
                                color={highlight}
                            />
                        </View>
                        <View style={styles.headerText}>
                            <Text style={[styles.eyebrow, { color: highlight }]}>{resourceLabel} 공유</Text>
                            <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
                                {title}
                            </Text>
                            {!!subtitle && (
                                <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                                    {subtitle}
                                </Text>
                            )}
                        </View>
                        <Pressable
                            onPress={onClose}
                            accessibilityRole="button"
                            accessibilityLabel="공유 닫기"
                            style={({ pressed }) => [
                                styles.closeButton,
                                { backgroundColor: colors.surface2, opacity: pressed ? 0.65 : 1 },
                            ]}
                        >
                            <Ionicons name="close" size={21} color={colors.textPrimary} />
                        </Pressable>
                    </View>

                    <View
                        onLayout={handleModeSegmentLayout}
                        style={[styles.modeSegment, { backgroundColor: colors.surface2 }]}
                    >
                        {modeIndicatorWidth > 0 ? (
                            <Animated.View
                                pointerEvents="none"
                                style={[
                                    styles.modeIndicator,
                                    {
                                        width: modeIndicatorWidth,
                                        backgroundColor: colors.surface,
                                        borderColor: colors.border,
                                        transform: [{ translateX: modeIndicatorTranslateX }],
                                    },
                                ]}
                            />
                        ) : null}
                        {([
                            { value: "direct" as const, label: "직접 공유", icon: "person-add-outline" as const },
                            { value: "link" as const, label: "링크 초대", icon: "link-outline" as const },
                        ]).map((option) => {
                            const selected = shareMode === option.value;
                            return (
                                <Pressable
                                    key={option.value}
                                    onPress={() => switchShareMode(option.value)}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected }}
                                    style={styles.modeOption}
                                >
                                    <Ionicons
                                        name={option.icon}
                                        size={17}
                                        color={selected ? colors.textPrimary : colors.textSecondary}
                                    />
                                    <Text style={[styles.modeOptionText, { color: selected ? colors.textPrimary : colors.textSecondary }]}>
                                        {option.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        style={styles.contentScroll}
                        contentContainerStyle={styles.content}
                    >
                        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>권한</Text>
                        <View style={styles.segmentRow}>
                            {PERMISSION_OPTIONS.map((option) => {
                                const selected = option.value === permission;
                                return (
                                    <Pressable
                                        key={option.value}
                                    onPress={() => setPermission(option.value)}
                                    accessibilityRole="radio"
                                    accessibilityLabel={`${option.label} 권한, ${option.description}`}
                                    accessibilityState={{ selected }}
                                        style={({ pressed }) => [
                                            styles.permissionOption,
                                            {
                                                backgroundColor: selected ? `${highlight}1E` : colors.surface2,
                                                borderColor: selected ? highlight : colors.border,
                                                opacity: pressed ? 0.68 : 1,
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.permissionLabel,
                                                { color: selected ? highlight : colors.textPrimary },
                                            ]}
                                        >
                                            {option.label}
                                        </Text>
                                        <Text
                                            style={[styles.permissionDescription, { color: colors.textSecondary }]}
                                            numberOfLines={2}
                                        >
                                            {option.description}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {resourceType !== "category" ? (
                            <>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>공유 범위</Text>
                                <View style={styles.contentModeRow}>
                                    {([
                                        {
                                            value: "SCHEDULE_ONLY" as const,
                                            label: "일정만",
                                            icon: "calendar-outline" as const,
                                        },
                                        {
                                            value: "SCHEDULE_AND_TRAVEL" as const,
                                            label: "일정 + 각자 경로",
                                            icon: "navigate-outline" as const,
                                        },
                                    ]).map((option) => {
                                        const selected = contentMode === option.value;
                                        return (
                                            <Pressable
                                                key={option.value}
                                                accessibilityRole="radio"
                                                accessibilityLabel={option.label}
                                                accessibilityState={{ selected }}
                                                onPress={() => setContentMode(option.value)}
                                                style={({ pressed }) => [
                                                    styles.contentModeOption,
                                                    {
                                                        backgroundColor: selected ? `${highlight}1E` : colors.surface2,
                                                        borderColor: selected ? highlight : colors.border,
                                                        opacity: pressed ? 0.68 : 1,
                                                    },
                                                ]}
                                            >
                                                <Ionicons
                                                    name={option.icon}
                                                    size={18}
                                                    color={selected ? highlight : colors.textSecondary}
                                                />
                                                <Text
                                                    style={[
                                                        styles.contentModeLabel,
                                                        { color: selected ? highlight : colors.textPrimary },
                                                    ]}
                                                    numberOfLines={2}
                                                >
                                                    {option.label}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </>
                        ) : null}

                        <Animated.View style={[styles.modeContent, modeContentAnimatedStyle]}>
                            {shareMode === "direct" ? (
                                <View style={styles.directTargetBlock}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>공유 대상</Text>
                                <View
                                    style={[
                                        styles.targetInputShell,
                                        {
                                            backgroundColor: colors.surface2,
                                            borderColor: directError ? "#FF453A" : colors.border,
                                        },
                                    ]}
                                >
                                    <Ionicons name="search-outline" size={19} color={colors.textSecondary} />
                                    <TextInput
                                        accessibilityLabel="공유 대상 회원 번호 또는 이메일"
                                        value={targetQuery}
                                        onChangeText={(value) => {
                                            setTargetQuery(value);
                                            setDirectError(null);
                                            setLastDirectShareLabel(null);
                                        }}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardType="email-address"
                                        placeholder="회원 #92 또는 name@example.com"
                                        placeholderTextColor={colors.textSecondary}
                                        returnKeyType="send"
                                        onSubmitEditing={() => {
                                            if (!submitDisabled) createDirectShare().catch(() => undefined);
                                        }}
                                        style={[styles.targetInput, { color: colors.textPrimary }]}
                                    />
                                    {!!targetQuery && (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="공유 대상 입력 지우기"
                                            onPress={() => setTargetQuery("")}
                                            hitSlop={8}
                                        >
                                            <Ionicons name="close-circle" size={19} color={colors.textSecondary} />
                                        </Pressable>
                                    )}
                                </View>
                                <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                    프로필의 회원 번호나 전체 이메일로 바로 공유합니다.
                                </Text>
                                {!!lastDirectShareLabel && (
                                    <View
                                        accessibilityLiveRegion="polite"
                                        style={[styles.directSuccess, { backgroundColor: `${highlight}18` }]}
                                    >
                                        <Ionicons name="checkmark-circle" size={19} color={highlight} />
                                        <Text style={[styles.directSuccessText, { color: colors.textPrimary }]} numberOfLines={1}>
                                            {lastDirectShareLabel}에게 공유했습니다
                                        </Text>
                                    </View>
                                )}
                                {!!directError && (
                                    <Text
                                        accessibilityLiveRegion="polite"
                                        style={[styles.errorText, { color: "#FF453A" }]}
                                    >
                                        {directError}
                                    </Text>
                                )}
                                </View>
                            ) : (
                                <>
                        <View style={styles.optionGrid}>
                            <View style={styles.optionBlock}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>만료</Text>
                                <View style={styles.chipRow}>
                                    {TTL_OPTIONS.map((option) => (
                                        <OptionChip
                                            key={option.value}
                                            label={option.label}
                                            selected={ttlHours === option.value}
                                            highlight={highlight}
                                            borderColor={colors.border}
                                            surfaceColor={colors.surface2}
                                            textColor={colors.textPrimary}
                                            onPress={() => setTtlHours(option.value)}
                                        />
                                    ))}
                                </View>
                            </View>

                            <View style={styles.optionBlock}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>수락 가능</Text>
                                <View style={styles.chipRow}>
                                    {ACCEPT_COUNT_OPTIONS.map((option) => (
                                        <OptionChip
                                            key={option.value}
                                            label={option.label}
                                            selected={maxAcceptCount === option.value}
                                            highlight={highlight}
                                            borderColor={colors.border}
                                            surfaceColor={colors.surface2}
                                            textColor={colors.textPrimary}
                                            onPress={() => setMaxAcceptCount(option.value)}
                                        />
                                    ))}
                                </View>
                            </View>
                        </View>

                        {!!generatedLink && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="생성한 공유 링크 다시 공유"
                                accessibilityValue={{ text: generatedLink }}
                                onPress={() => shareGeneratedLink(generatedLink).catch(() => undefined)}
                                style={({ pressed }) => [
                                    styles.generatedLink,
                                    {
                                        backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#F8FAFC",
                                        borderColor: colors.border,
                                        opacity: pressed ? 0.72 : 1,
                                    },
                                ]}
                            >
                                <Ionicons name="link-outline" size={20} color={highlight} />
                                <Text style={[styles.generatedLinkText, { color: colors.textPrimary }]} numberOfLines={1}>
                                    {generatedLink}
                                </Text>
                                <Ionicons name="share-outline" size={19} color={colors.textSecondary} />
                            </Pressable>
                        )}

                        <View style={[styles.invitationPanel, { borderColor: colors.border }]}>
                            <View style={styles.invitationHeader}>
                                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>최근 초대</Text>
                                {loading ? (
                                    <BrandedLoader
                                        size="button"
                                        variant="share"
                                        accessibilityLabel="최근 초대를 불러오고 있어요"
                                    />
                                ) : null}
                            </View>
                            {linkError ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`${linkError}. 최근 공유 초대 다시 불러오기`}
                                    accessibilityState={{ disabled: loading, busy: loading }}
                                    disabled={loading}
                                    onPress={() => loadInvitations().catch(() => undefined)}
                                    style={({ pressed }) => [
                                        styles.invitationRetry,
                                        { opacity: pressed ? 0.62 : 1 },
                                    ]}
                                >
                                    <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
                                    <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                        {linkError} · 다시 시도
                                    </Text>
                                </Pressable>
                            ) : latestInvitation ? (
                                <View style={styles.invitationSummary}>
                                    <View style={[styles.statusDot, { backgroundColor: highlight }]} />
                                    <View style={styles.invitationSummaryText}>
                                        <Text style={[styles.invitationTitle, { color: colors.textPrimary }]}>
                                            {statusLabel(latestInvitation.status)} · {permissionLabel(latestInvitation.permission)}
                                        </Text>
                                        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                            {latestInvitation.acceptedCount}/{latestInvitation.maxAcceptCount}명 수락 · {formatExpiresAt(latestInvitation.expiresAt)} 만료
                                        </Text>
                                    </View>
                                    {latestInvitation.status === "PENDING" ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="공유 링크 해제"
                                            disabled={Boolean(revokingInvitationId)}
                                            accessibilityState={{ disabled: Boolean(revokingInvitationId) }}
                                            onPress={() => revokeInvitation(latestInvitation)}
                                            style={({ pressed }) => [styles.revokeButton, { opacity: pressed ? 0.6 : 1 }]}
                                        >
                                            {revokingInvitationId === latestInvitation.id ? (
                                                <BrandedLoader size="button" variant="share" accessibilityLabel="공유 링크를 해제하고 있어요" />
                                            ) : (
                                                <Text style={styles.revokeButtonText}>링크 해제</Text>
                                            )}
                                        </Pressable>
                                    ) : null}
                                </View>
                            ) : (
                                <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                                    아직 생성한 공유 링크가 없어요.
                                </Text>
                            )}
                        </View>
                                </>
                            )}
                        </Animated.View>
                    </ScrollView>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={shareMode === "direct" ? "이 대상에게 공유" : "링크 만들고 공유"}
                        disabled={submitDisabled}
                        accessibilityState={{ disabled: submitDisabled, busy: submitting }}
                        onPress={shareMode === "direct" ? createDirectShare : createInvitation}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            {
                                backgroundColor: highlight,
                                opacity: submitDisabled ? 0.45 : pressed ? 0.78 : 1,
                            },
                        ]}
                    >
                        {submitting ? (
                            <BrandedLoader
                                size="button"
                                variant="share"
                                accessibilityLabel="공유를 준비하고 있어요"
                            />
                        ) : (
                            <>
                                <Ionicons
                                    name={shareMode === "direct" ? "paper-plane-outline" : "link-outline"}
                                    size={20}
                                    color="#FFFFFF"
                                />
                                <Text style={styles.primaryButtonText}>
                                    {shareMode === "direct" ? "이 대상에게 공유" : "링크 만들고 공유"}
                                </Text>
                            </>
                        )}
                    </Pressable>
                    </Reanimated.View>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
}
