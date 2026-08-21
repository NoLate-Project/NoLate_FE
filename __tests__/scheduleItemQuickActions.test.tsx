import React from 'react';
import { ActionSheetIOS, Alert } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { deleteSchedule } from '../src/api/schedule';
import { getAuthMember } from '../src/modules/auth/authStorage';
import { recoverDepartureAlarmsAfterMutation } from '../src/modules/notification/departureAlarmMutationRecovery';
import { useScheduleItemQuickActions } from '../src/modules/schedule/hooks/useScheduleItemQuickActions';
import type { ScheduleItem } from '../src/modules/schedule/types';

const mockPush = jest.fn();
const mockDispatch = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../src/modules/schedule/store', () => ({
  useScheduleStore: () => ({ dispatch: mockDispatch }),
}));

jest.mock('../src/api/schedule', () => ({
  deleteSchedule: jest.fn(),
}));

jest.mock('../src/modules/auth/authStorage', () => ({
  getAuthMember: jest.fn(),
}));

jest.mock(
  '../src/modules/notification/departureAlarmMutationRecovery',
  () => ({ recoverDepartureAlarmsAfterMutation: jest.fn() }),
);

const item: ScheduleItem = {
  id: 'schedule-17',
  title: '팀 회의',
  startAt: '2026-08-17T01:00:00.000Z',
  endAt: '2026-08-17T02:00:00.000Z',
  ownerMemberId: 7,
  category: { id: 'work', title: '업무', color: '#2979FF' },
};

describe('schedule item quick actions', () => {
  let quickActions: ReturnType<typeof useScheduleItemQuickActions> | undefined;
  let renderer: TestRenderer.ReactTestRenderer | undefined;

  function Harness() {
    quickActions = useScheduleItemQuickActions();
    return null;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthMember as jest.MockedFunction<typeof getAuthMember>).mockResolvedValue({ id: 7 });
    (deleteSchedule as jest.MockedFunction<typeof deleteSchedule>).mockResolvedValue();
    (
      recoverDepartureAlarmsAfterMutation as jest.MockedFunction<
        typeof recoverDepartureAlarmsAfterMutation
      >
    ).mockResolvedValue();
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    quickActions = undefined;
    jest.restoreAllMocks();
  });

  async function renderHarness() {
    await act(async () => {
      renderer = TestRenderer.create(<Harness />);
    });
  }

  test('작성자는 길게 누른 메뉴에서 수정 화면으로 바로 이동한다', async () => {
    const showActionSheet = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);
    await renderHarness();

    await act(async () => quickActions?.requestScheduleQuickActions(item));

    expect(showActionSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '팀 회의',
        options: ['수정', '삭제', '취소'],
        cancelButtonIndex: 2,
        destructiveButtonIndex: 1,
      }),
      expect.any(Function),
    );

    const selectAction = showActionSheet.mock.calls[0]?.[1];
    act(() => selectAction?.(0));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/schedule/[id]',
      params: { id: 'schedule-17', mode: 'edit' },
    });
  });

  test('삭제는 확인 후 서버와 현재 목록, 알람 상태에 순서대로 반영한다', async () => {
    const showActionSheet = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);
    const showAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderHarness();

    await act(async () => quickActions?.requestScheduleQuickActions(item));
    act(() => showActionSheet.mock.calls[0]?.[1]?.(1));

    const confirmationButtons = showAlert.mock.calls[0]?.[2];
    const deleteButton = confirmationButtons?.find(button => button.text === '삭제');
    await act(async () => deleteButton?.onPress?.());

    expect(deleteSchedule).toHaveBeenCalledWith('schedule-17');
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'DELETE_ITEM',
      id: 'schedule-17',
    });
    expect(recoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
  });

  test('편집자는 수정만, 조회자는 권한 안내만 제공한다', async () => {
    const showActionSheet = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);
    const showAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (getAuthMember as jest.MockedFunction<typeof getAuthMember>).mockResolvedValue({ id: 9 });
    await renderHarness();

    await act(async () =>
      quickActions?.requestScheduleQuickActions({
        ...item,
        sharePermission: 'EDITOR',
      }),
    );
    expect(showActionSheet).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: ['수정', '취소'] }),
      expect.any(Function),
    );

    await act(async () =>
      quickActions?.requestScheduleQuickActions({
        ...item,
        sharePermission: 'VIEWER',
      }),
    );
    expect(showAlert).toHaveBeenLastCalledWith(
      '일정 관리',
      '이 일정은 수정하거나 삭제할 권한이 없어요.',
    );
  });

  test('스와이프 수정·삭제도 동일한 권한과 삭제 확인 흐름을 사용한다', async () => {
    const showAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderHarness();

    const ownerActions = quickActions?.getScheduleSwipeActions(item);
    expect(ownerActions?.onEdit).toEqual(expect.any(Function));
    expect(ownerActions?.onDelete).toEqual(expect.any(Function));

    await act(async () => ownerActions?.onEdit?.());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/schedule/[id]',
      params: { id: 'schedule-17', mode: 'edit' },
    });

    await act(async () => ownerActions?.onDelete?.());
    expect(showAlert).toHaveBeenCalledWith(
      '일정을 삭제할까요?',
      expect.stringContaining('팀 회의'),
      expect.any(Array),
    );
    expect(deleteSchedule).not.toHaveBeenCalled();
  });

  test('조회자에게는 스와이프 작업을 노출하지 않는다', async () => {
    (getAuthMember as jest.MockedFunction<typeof getAuthMember>).mockResolvedValue({ id: 9 });
    await renderHarness();

    expect(quickActions?.getScheduleSwipeActions({
      ...item,
      sharePermission: 'VIEWER',
    })).toBeUndefined();
  });
});
