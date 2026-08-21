import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';

import { deleteSchedule } from '../../../api/schedule';
import { getAuthMember } from '../../auth/authStorage';
import { recoverDepartureAlarmsAfterMutation } from '../../notification/departureAlarmMutationRecovery';
import {
  canDeletePresentedSchedule,
  canEditPresentedSchedule,
} from '../schedulePermissions';
import { useScheduleStore } from '../store';
import type { ScheduleItem } from '../types';
import type { ScheduleSwipeActionResolver } from '../components/ScheduleSwipeActions';

type ScheduleQuickAction = 'edit' | 'delete';

function getQuickActionErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : '요청 처리에 실패했습니다.';
  if (/network|timeout/i.test(message)) {
    return '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  }
  return message;
}

/** 목록과 시간표 카드에서 상세 화면을 거치지 않고 수정·삭제를 실행한다. */
export function useScheduleItemQuickActions() {
  const router = useRouter();
  const { dispatch } = useScheduleStore();
  const deletingIdsRef = useRef(new Set<string>());
  const [currentMemberId, setCurrentMemberId] = useState<number | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let active = true;
    getAuthMember()
      .then(member => {
        if (active) setCurrentMemberId(member?.id ?? null);
      })
      .catch(() => {
        if (active) setCurrentMemberId(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const getActionAvailability = useCallback(
    (item: ScheduleItem, memberId: number | null | undefined) => {
      const isOwner =
        typeof item.ownerMemberId === 'number'
          ? memberId === item.ownerMemberId
          : item.sharePermission == null;
      return {
        canEdit: canEditPresentedSchedule(item, isOwner),
        canDelete: canDeletePresentedSchedule(item, memberId),
      };
    },
    [],
  );

  const resolveActionAvailability = useCallback(
    async (item: ScheduleItem) => {
      const memberId =
        currentMemberId !== undefined
          ? currentMemberId
          : await getAuthMember()
              .then(member => member?.id ?? null)
              .catch(() => null);
      return getActionAvailability(item, memberId);
    },
    [currentMemberId, getActionAvailability],
  );

  const openEditor = useCallback(
    (item: ScheduleItem) => {
      router.push({
        pathname: '/schedule/[id]',
        params: { id: item.id, mode: 'edit' },
      });
    },
    [router],
  );

  const confirmDelete = useCallback(
    (item: ScheduleItem) => {
      if (deletingIdsRef.current.has(item.id)) return;

      Alert.alert(
        '일정을 삭제할까요?',
        `“${item.title}” 일정은 삭제 후 되돌릴 수 없어요.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '삭제',
            style: 'destructive',
            onPress: async () => {
              if (deletingIdsRef.current.has(item.id)) return;
              deletingIdsRef.current.add(item.id);
              try {
                await deleteSchedule(item.id);
                dispatch({ type: 'DELETE_ITEM', id: item.id });
                await recoverDepartureAlarmsAfterMutation();
              } catch (error) {
                Alert.alert(
                  '일정 삭제 실패',
                  getQuickActionErrorMessage(error),
                );
              } finally {
                deletingIdsRef.current.delete(item.id);
              }
            },
          },
        ],
      );
    },
    [dispatch],
  );

  const showPermissionAlert = useCallback(() => {
    Alert.alert('일정 관리', '이 일정은 수정하거나 삭제할 권한이 없어요.');
  }, []);

  const requestScheduleEdit = useCallback(
    async (item: ScheduleItem) => {
      const { canEdit } = await resolveActionAvailability(item);
      if (!canEdit) {
        showPermissionAlert();
        return;
      }
      openEditor(item);
    },
    [openEditor, resolveActionAvailability, showPermissionAlert],
  );

  const requestScheduleDelete = useCallback(
    async (item: ScheduleItem) => {
      const { canDelete } = await resolveActionAvailability(item);
      if (!canDelete) {
        showPermissionAlert();
        return;
      }
      confirmDelete(item);
    },
    [confirmDelete, resolveActionAvailability, showPermissionAlert],
  );

  const requestScheduleQuickActions = useCallback(
    async (item: ScheduleItem) => {
      const { canEdit, canDelete } = await resolveActionAvailability(item);

      const actions: ScheduleQuickAction[] = [];
      if (canEdit) actions.push('edit');
      if (canDelete) actions.push('delete');

      if (actions.length === 0) {
        showPermissionAlert();
        return;
      }

      const runAction = (action?: ScheduleQuickAction) => {
        if (action === 'edit') openEditor(item);
        if (action === 'delete') confirmDelete(item);
      };

      if (Platform.OS === 'ios') {
        const options = [
          ...actions.map(action => (action === 'edit' ? '수정' : '삭제')),
          '취소',
        ];
        const destructiveButtonIndex = actions.indexOf('delete');
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: item.title,
            message: '일정에서 바로 실행할 작업을 선택하세요.',
            options,
            cancelButtonIndex: options.length - 1,
            ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
          },
          buttonIndex => runAction(actions[buttonIndex]),
        );
        return;
      }

      Alert.alert(
        item.title,
        '일정에서 바로 실행할 작업을 선택하세요.',
        [
          { text: '취소', style: 'cancel' },
          ...actions.map(action => ({
            text: action === 'edit' ? '수정' : '삭제',
            style: action === 'delete' ? ('destructive' as const) : ('default' as const),
            onPress: () => runAction(action),
          })),
        ],
      );
    },
    [confirmDelete, openEditor, resolveActionAvailability, showPermissionAlert],
  );

  const getScheduleSwipeActions = useCallback<ScheduleSwipeActionResolver>(
    item => {
      // 작성자 정보가 아직 복원되지 않았다면 권한이 노출되지 않도록 잠시 숨긴다.
      if (currentMemberId === undefined && typeof item.ownerMemberId === 'number') {
        return undefined;
      }
      const { canEdit, canDelete } = getActionAvailability(
        item,
        currentMemberId,
      );
      if (!canEdit && !canDelete) return undefined;
      return {
        onEdit: canEdit ? () => {
          requestScheduleEdit(item);
        } : undefined,
        onDelete: canDelete ? () => {
          requestScheduleDelete(item);
        } : undefined,
      };
    },
    [
      currentMemberId,
      getActionAvailability,
      requestScheduleDelete,
      requestScheduleEdit,
    ],
  );

  return {
    getScheduleSwipeActions,
    requestScheduleDelete,
    requestScheduleEdit,
    requestScheduleQuickActions,
  };
}
