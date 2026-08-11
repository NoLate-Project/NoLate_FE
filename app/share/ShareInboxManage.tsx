import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import styles from './inbox.styles';

import {
  type ScheduleShare,
  type ShareInvitationSummary,
} from '../../src/api/scheduleSharing';
import {
  type ShareLibraryItem,
  type ShareLibraryTab,
} from '../../src/modules/share/shareInboxPresentation';
import { type AppColors } from '../../src/modules/theme/ThemeContext';
import BrandedLoader from '../../src/ui/BrandedLoader';

import {
  contentModeLabel,
  formatExpiration,
  permissionLabel,
  ROUTE_AMBER,
} from './shareInboxModel';

/** 선택한 공유 항목의 초대·직접 공유를 확인하고 회수하는 관리 시트입니다. */
export function ManageShareSheet({
  item,
  colors,
  accent,
  bottomInset,
  revokingShareId,
  revokingInvitationId,
  onClose,
  onOpenResource,
  onOpenComposer,
  onRevokeShare,
  onRevokeInvitation,
}: {
  item: ShareLibraryItem | null;
  colors: AppColors;
  accent: string;
  bottomInset: number;
  revokingShareId: string | null;
  revokingInvitationId: string | null;
  onClose: () => void;
  onOpenResource: () => void;
  onOpenComposer: () => void;
  onRevokeShare: (share: ScheduleShare) => void;
  onRevokeInvitation: (invitation: ShareInvitationSummary) => void;
}) {
  const editorCount =
    item?.shares.filter(share => share.permission === 'EDITOR').length ?? 0;
  const viewerCount = Math.max(0, (item?.shares.length ?? 0) - editorCount);
  const itemColor = item?.color || accent;

  return (
    <Modal
      visible={Boolean(item)}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot} accessibilityViewIsModal>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="공유 관리 닫기"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        {item ? (
          <View
            style={[
              styles.manageSheet,
              {
                backgroundColor: colors.surface,
                paddingBottom: Math.max(bottomInset, 14) + 8,
              },
            ]}
          >
            <View
              style={[styles.sheetHandle, { backgroundColor: colors.border }]}
            />
            <View style={styles.manageHeader}>
              <View
                style={[
                  styles.manageResourceIcon,
                  { backgroundColor: `${itemColor}18` },
                ]}
              >
                <Ionicons
                  name={
                    item.tab === 'schedule'
                      ? 'calendar-outline'
                      : 'calendar-clear-outline'
                  }
                  size={21}
                  color={itemColor}
                />
              </View>
              <View style={styles.manageHeaderCopy}>
                <Text
                  numberOfLines={1}
                  style={[styles.manageTitle, { color: colors.textPrimary }]}
                >
                  {item.title}
                </Text>
                <Text
                  style={[styles.manageMeta, { color: colors.textSecondary }]}
                >
                  내가 공유 · {item.shareCount}명
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="공유 관리 닫기"
                onPress={onClose}
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.surface2 },
                ]}
              >
                <Ionicons name="close" size={21} color={colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.manageContent}
            >
              <ManageAction
                icon="person-add-outline"
                title="공유 대상 추가"
                description="이메일 또는 앱 ID, 링크로 초대"
                colors={colors}
                accent={accent}
                onPress={onOpenComposer}
              />
              <ManageAction
                icon={
                  item.tab === 'schedule'
                    ? 'navigate-outline'
                    : 'options-outline'
                }
                title={item.tab === 'schedule' ? '공유 범위' : '기본 공유 범위'}
                description={contentModeLabel(item.contentMode)}
                colors={colors}
                accent={accent}
                onPress={onOpenResource}
              />

              <View
                style={[
                  styles.manageSection,
                  { borderTopColor: colors.border },
                ]}
              >
                <View style={styles.manageSectionHeading}>
                  <View style={styles.manageSectionTitleRow}>
                    <Ionicons
                      name="people-outline"
                      size={18}
                      color={colors.textPrimary}
                    />
                    <Text
                      style={[
                        styles.manageSectionTitle,
                        { color: colors.textPrimary },
                      ]}
                    >
                      공유 대상
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.manageSectionCount,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {item.shares.length}명 · 편집 {editorCount} · 보기{' '}
                    {viewerCount}
                  </Text>
                </View>

                {item.shares.length === 0 ? (
                  <Text
                    style={[
                      styles.manageEmptyText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    아직 공유를 수락한 사람이 없어요.
                  </Text>
                ) : (
                  item.shares.map((share, index) => {
                    const target =
                      share.targetEmail?.trim() ||
                      `NoLate ID #${share.targetMemberId}`;
                    const revoking = revokingShareId === share.id;
                    return (
                      <View
                        key={share.id}
                        style={[
                          styles.memberRow,
                          index > 0 && styles.memberRowDivider,
                          { borderTopColor: colors.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.memberAvatar,
                            { backgroundColor: `${accent}18` },
                          ]}
                        >
                          <Text
                            style={[styles.memberAvatarText, { color: accent }]}
                          >
                            {target.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.memberCopy}>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.memberName,
                              { color: colors.textPrimary },
                            ]}
                          >
                            {target}
                          </Text>
                          <Text
                            style={[
                              styles.memberPermission,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {permissionLabel(share.permission)} 권한
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${target} 공유 해제`}
                          accessibilityState={{
                            disabled: Boolean(revokingShareId),
                            busy: revoking,
                          }}
                          disabled={Boolean(revokingShareId)}
                          onPress={() => onRevokeShare(share)}
                          style={({ pressed }) => [
                            styles.memberActionButton,
                            { opacity: pressed || revokingShareId ? 0.5 : 1 },
                          ]}
                        >
                          {revoking ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.textSecondary}
                            />
                          ) : (
                            <Ionicons
                              name="person-remove-outline"
                              size={19}
                              color={colors.textSecondary}
                            />
                          )}
                        </Pressable>
                      </View>
                    );
                  })
                )}
              </View>

              {item.activeInvitations.length > 0 ? (
                <View
                  style={[
                    styles.manageSection,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <View style={styles.manageSectionHeading}>
                    <View style={styles.manageSectionTitleRow}>
                      <Ionicons
                        name="link-outline"
                        size={18}
                        color={colors.textPrimary}
                      />
                      <Text
                        style={[
                          styles.manageSectionTitle,
                          { color: colors.textPrimary },
                        ]}
                      >
                        활성 링크
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.manageSectionCount,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {item.activeInvitations.length}개
                    </Text>
                  </View>
                  {item.activeInvitations.map((invitation, index) => {
                    const revoking = revokingInvitationId === invitation.id;
                    return (
                      <View
                        key={invitation.id}
                        style={[
                          styles.linkManageRow,
                          index > 0 && styles.memberRowDivider,
                          { borderTopColor: colors.border },
                        ]}
                      >
                        <View style={styles.memberCopy}>
                          <Text
                            style={[
                              styles.memberName,
                              { color: colors.textPrimary },
                            ]}
                          >
                            {permissionLabel(invitation.permission)} 링크
                          </Text>
                          <Text
                            style={[
                              styles.memberPermission,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {invitation.acceptedCount}/
                            {invitation.maxAcceptCount}명 ·{' '}
                            {formatExpiration(invitation.expiresAt)}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${item.title} 공유 링크 비활성화`}
                          accessibilityState={{
                            disabled: Boolean(revokingInvitationId),
                            busy: revoking,
                          }}
                          disabled={Boolean(revokingInvitationId)}
                          onPress={() => onRevokeInvitation(invitation)}
                          style={({ pressed }) => [
                            styles.memberActionButton,
                            {
                              opacity:
                                pressed || revokingInvitationId ? 0.5 : 1,
                            },
                          ]}
                        >
                          {revoking ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.textSecondary}
                            />
                          ) : (
                            <Ionicons
                              name="unlink-outline"
                              size={19}
                              color={colors.textSecondary}
                            />
                          )}
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** 관리 시트에서 실행할 단일 동작을 아이콘과 위험 상태로 표현합니다. */
function ManageAction({
  icon,
  title,
  description,
  colors,
  accent,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  colors: AppColors;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${description}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.manageAction,
        {
          borderBottomColor: colors.border,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <View
        style={[styles.manageActionIcon, { backgroundColor: `${accent}16` }]}
      >
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View style={styles.manageActionCopy}>
        <Text style={[styles.manageActionTitle, { color: colors.textPrimary }]}>
          {title}
        </Text>
        <Text
          style={[
            styles.manageActionDescription,
            { color: colors.textSecondary },
          ]}
        >
          {description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textDisabled} />
    </Pressable>
  );
}

/** 기존 목록을 유지한 채 재시도할 수 있는 인라인 오류 메시지를 표시합니다. */
export function InlineErrorCard({
  colors,
  text,
  onRetry,
}: {
  colors: AppColors;
  text: string;
  onRetry: () => void;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.inlineError,
        { backgroundColor: colors.surface2, borderColor: colors.border },
      ]}
    >
      <Ionicons name="alert-circle-outline" size={18} color={ROUTE_AMBER} />
      <Text
        numberOfLines={2}
        style={[styles.inlineErrorText, { color: colors.textSecondary }]}
      >
        {text}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="공유함 다시 조회"
        onPress={onRetry}
        hitSlop={8}
      >
        <Text style={[styles.inlineRetryText, { color: colors.textPrimary }]}>
          다시 시도
        </Text>
      </Pressable>
    </View>
  );
}

/** 검색·필터 여부와 공유 종류에 맞는 빈 목록 안내를 표시합니다. */
export function EmptyState({
  colors,
  searching,
  tab,
}: {
  colors: AppColors;
  searching: boolean;
  tab: ShareLibraryTab;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surface2 }]}>
        <Ionicons
          name={
            searching
              ? 'search-outline'
              : tab === 'schedule'
              ? 'calendar-outline'
              : 'calendar-clear-outline'
          }
          size={25}
          color={colors.textSecondary}
        />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
        {searching
          ? '검색 결과가 없어요'
          : tab === 'schedule'
          ? '공유 일정이 없어요'
          : '공유 캘린더가 없어요'}
      </Text>
      <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>
        {searching
          ? '다른 이름이나 공유자를 입력해 보세요.'
          : '공유받거나 내가 공유한 항목이 여기에 모여요.'}
      </Text>
    </View>
  );
}

/** 최초 로딩 또는 치명적 오류 상태를 중앙 안내 화면으로 표시합니다. */
export function StateView({
  colors,
  text,
  loading = false,
  onRetry,
}: {
  colors: AppColors;
  text: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={loading ? 'progressbar' : undefined}
      accessibilityLabel={text}
      style={styles.stateView}
    >
      {loading ? (
        <BrandedLoader
          size="section"
          variant="share"
          accessibilityLabel={text}
        />
      ) : (
        <Ionicons
          name="cloud-offline-outline"
          size={26}
          color={colors.textSecondary}
        />
      )}
      <Text style={[styles.stateText, { color: colors.textSecondary }]}>
        {text}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.stateRetryButton, { borderColor: colors.border }]}
        >
          <Text style={[styles.stateRetryText, { color: colors.textPrimary }]}>
            다시 조회
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
