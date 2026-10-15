import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import IntercityTimetableSheet from '../src/modules/schedule/components/route/IntercityTimetableSheet';
import { getIntercityCities, getIntercityServices, getIntercityStops } from '../src/api/intercityTimetable';
import type { IntercitySelection } from '../src/modules/schedule/intercityJourney';
import type { ImportedTrainTicket } from '../src/modules/schedule/importedTicket';
jest.mock('../src/api/intercityTimetable', () => ({ getIntercityCities: jest.fn(), getIntercityServices: jest.fn(), getIntercityStops: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const service = { id: 'tago:test', kind: 'TRAIN', departureId: 'NATH30000', arrivalId: 'NATH20438', departureName: '수서', arrivalName: '공주', departureAt: '2099-10-13T12:20+09:00', arrivalAt: '2099-10-13T13:18+09:00', serviceDate: '2099-10-13', grade: 'KTX', trainNumber: '123', timingBasis: 'TIMETABLE', bookingStatus: 'UNCONFIRMED' };
const page = (items: unknown[]) => ({ status: 'AVAILABLE', items, page: 1, hasMore: false, source: 'TAGO', fetchedAt: new Date().toISOString() });
beforeEach(() => {
  jest.clearAllMocks();
  (getIntercityCities as jest.Mock).mockResolvedValue(page([{ code: '11', name: '서울특별시' }]));
  (getIntercityStops as jest.Mock).mockResolvedValueOnce(page([{ id: 'NATH30000', name: '수서' }])).mockResolvedValueOnce(page([{ id: 'NATH20438', name: '공주' }]));
  (getIntercityServices as jest.Mock).mockResolvedValue(page([service]));
});
function get(view: ReactTestRenderer, label: string) {
  const button = view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}
async function press(view: ReactTestRenderer, label: string) { await act(async () => { const button = get(view, label); if (!button.props.disabled) button.props.onPress(); }); }
async function choose(onSelect: (selection: IntercitySelection, isCurrent: () => boolean) => Promise<void>) {
  const close = jest.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = TestRenderer.create(<IntercityTimetableSheet kind="TRAIN" date={new Date('2099-10-13T00:00:00+09:00')} dark={false} departureName="수서" arrivalName="공주" onClose={close} onSelect={onSelect} />); });
  await press(view, '출발 역·터미널 선택');
  expect(get(view, '서울특별시')).toBeTruthy();
  await press(view, '서울특별시');
  await press(view, '역 터미널 검색');
  expect(get(view, '수서 NATH30000')).toBeTruthy();
  await press(view, '수서 NATH30000');
  await press(view, '도착 역·터미널 선택');
  await press(view, '역 터미널 검색');
  expect(get(view, '공주 NATH20438')).toBeTruthy();
  await press(view, '공주 NATH20438');
  await press(view, '운행편 조회');
  expect(get(view, '12:20 123 운행편 선택')).toBeTruthy();
  await press(view, '12:20 123 운행편 선택');
  return { view, close };
}
test('lookup and row selection do not apply a journey until station mapping is confirmed', async () => {
  const select = jest.fn().mockResolvedValue(undefined);
  const { view, close } = await choose(select);
  expect(select).not.toHaveBeenCalled();
  await press(view, '이 운행편으로 경로 연결');
  expect(select).not.toHaveBeenCalled();
  await press(view, '같은 승하차 장소입니다');
  await press(view, '이 운행편으로 경로 연결');
  expect(close).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ service, mappingConfirmed: true, boardingBufferMinutes: 15, alightingBufferMinutes: 5 }), expect.any(Function));
});
test.each(['cancel', 'unmount'])('%s invalidates a pending connection response', async action => {
  let finish!: () => void; let current!: () => boolean;
  const select = jest.fn((_selection, active) => { current = active; return new Promise<void>(resolve => { finish = resolve; }); });
  const { view, close } = await choose(select);
  await press(view, '같은 승하차 장소입니다');
  await press(view, '이 운행편으로 경로 연결');
  expect(current()).toBe(true);
  if (action === 'cancel') await press(view, '운행편 선택 취소'); else act(() => view.unmount());
  expect(current()).toBe(false);
  await act(async () => { finish(); });
  expect(close).not.toHaveBeenCalled();
});
test('reviewed ticket is available without TAGO and still requires mapping confirmation', async () => {
  const ticket: ImportedTrainTicket = { version: 1, id: 'ticket:12345678-1234-1234-1234-123456789012', kind: 'TRAIN', source: 'IOS_SHARE_TEXT', verification: 'USER_CONFIRMED', bookingStatus: 'UNVERIFIED', departureName: '수서', arrivalName: '공주', departureAt: '2099-10-13T12:20:00+09:00', arrivalAt: '2099-10-13T13:12:00+09:00', trainNumber: '615', grade: 'SRT', confirmedAt: new Date().toISOString() };
  const select = jest.fn().mockResolvedValue(undefined); const close = jest.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = TestRenderer.create(<IntercityTimetableSheet importedTicket={ticket} kind="TRAIN" date={new Date()} dark={false} onClose={close} onSelect={select} />); });
  await press(view, '가져온 승차권으로 연결');
  await press(view, '이 운행편으로 경로 연결');
  expect(select).not.toHaveBeenCalled();
  await press(view, '같은 승하차 장소입니다');
  await press(view, '이 운행편으로 경로 연결');
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ service: expect.objectContaining({ timingBasis: 'TICKET', bookingStatus: 'UNVERIFIED', trainNumber: '615' }), alightingBufferMinutes: 0 }), expect.any(Function));
  expect(getIntercityServices).not.toHaveBeenCalled(); expect(getIntercityCities).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});
