import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import ScheduleSwipeActions from '../src/modules/schedule/components/ScheduleSwipeActions';

jest.mock('@expo/vector-icons', () => {
  const ReactModule = require('react');
  const { Text: MockText } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => ReactModule.createElement(
      MockText,
      null,
      name,
    ),
  };
});

describe('schedule swipe actions', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  let actionsRenderer: TestRenderer.ReactTestRenderer | undefined;

  afterEach(async () => {
    await act(async () => {
      actionsRenderer?.unmount();
      renderer?.unmount();
    });
    actionsRenderer = undefined;
    renderer = undefined;
  });

  test('왼쪽 스와이프 영역에서 닫기 요청 후 수정·삭제 콜백을 실행한다', async () => {
    const callOrder: string[] = [];
    const onEdit = jest.fn(() => callOrder.push('edit'));
    const onDelete = jest.fn(() => callOrder.push('delete'));

    await act(async () => {
      renderer = TestRenderer.create(
        <ScheduleSwipeActions
          itemTitle="팀 회의"
          onEdit={onEdit}
          onDelete={onDelete}
        >
          <Text>팀 회의</Text>
        </ScheduleSwipeActions>,
      );
    });

    const swipeable = renderer!.root.find(
      node => typeof node.props.renderRightActions === 'function',
    );
    const methods = {
      close: jest.fn(() => callOrder.push('close')),
      openLeft: jest.fn(),
      openRight: jest.fn(),
      reset: jest.fn(),
    };

    await act(async () => swipeable.props.onSwipeableWillOpen());
    await act(async () => {
      actionsRenderer = TestRenderer.create(
        swipeable.props.renderRightActions({}, {}, methods),
      );
    });

    const edit = actionsRenderer!.root.findByProps({
      testID: 'schedule-swipe-edit-action',
    });
    act(() => edit.props.onPress());
    expect(callOrder).toEqual(['close', 'edit']);
    expect(onEdit).toHaveBeenCalledTimes(1);

    callOrder.length = 0;
    const remove = actionsRenderer!.root.findByProps({
      testID: 'schedule-swipe-delete-action',
    });
    act(() => remove.props.onPress());
    expect(callOrder).toEqual(['close', 'delete']);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test('허용된 작업만 렌더링하고 권한이 없으면 swipe를 비활성화한다', async () => {
    await act(async () => {
      renderer = TestRenderer.create(
        <ScheduleSwipeActions itemTitle="공유 일정" onEdit={jest.fn()}>
          <Text>공유 일정</Text>
        </ScheduleSwipeActions>,
      );
    });

    let swipeable = renderer!.root.find(
      node => Object.prototype.hasOwnProperty.call(node.props, 'renderRightActions'),
    );
    expect(swipeable.props.enabled).toBe(true);
    await act(async () => {
      actionsRenderer = TestRenderer.create(
        swipeable.props.renderRightActions({}, {}, {
          close: jest.fn(),
          openLeft: jest.fn(),
          openRight: jest.fn(),
          reset: jest.fn(),
        }),
      );
    });
    expect(actionsRenderer!.root.findAllByProps({
      testID: 'schedule-swipe-edit-action',
    }).length).toBeGreaterThan(0);
    expect(actionsRenderer!.root.findAllByProps({
      testID: 'schedule-swipe-delete-action',
    })).toHaveLength(0);

    await act(async () => {
      renderer!.update(
        <ScheduleSwipeActions itemTitle="공유 일정">
          <Text>공유 일정</Text>
        </ScheduleSwipeActions>,
      );
    });
    swipeable = renderer!.root.find(
      node => Object.prototype.hasOwnProperty.call(node.props, 'renderRightActions'),
    );
    expect(swipeable.props.enabled).toBe(false);
    expect(swipeable.props.renderRightActions).toBeUndefined();
  });
});
