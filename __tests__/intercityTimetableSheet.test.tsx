jest.mock("../src/ui/BrandedLoader", () => "BrandedLoader");
jest.mock("../src/ui/LoadingIndicator", () => "LoadingIndicator");
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
import React from 'react';
import { Dimensions, Platform, Text } from 'react-native';
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
  (getIntercityCities as jest.Mock).mockResolvedValue(page([
    { code: '11', name: '서울특별시' }, { code: '44', name: '충청남도' },
  ]));
  (getIntercityStops as jest.Mock).mockResolvedValueOnce(page([{ id: 'NATH30000', name: '수서' }])).mockResolvedValueOnce(page([{ id: 'NATH20438', name: '공주' }]));
  (getIntercityServices as jest.Mock).mockResolvedValue(page([service]));
});
afterEach(() => jest.restoreAllMocks());
function get(view: ReactTestRenderer, label: string) {
  const button = view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}
async function press(view: ReactTestRenderer, label: string) { await act(async () => { const button = get(view, label); if (!button.props.disabled) button.props.onPress(); }); }
async function lookupServices(onSelect: (selection: IntercitySelection, isCurrent: () => boolean) => Promise<void>, targetArrivalAt?: Date) {
  const close = jest.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = TestRenderer.create(<IntercityTimetableSheet kind="TRAIN" date={new Date('2099-10-13T00:00:00+09:00')} targetArrivalAt={targetArrivalAt} dark={false} departureName="수서" arrivalName="공주" onClose={close} onSelect={onSelect} />); });
  await press(view, '출발 역·터미널 선택');
  expect(view.root.findAll(node => node.props.accessibilityLabel === '서울특별시')).toHaveLength(0);
  await press(view, '시·도 선택');
  expect(get(view, '서울특별시')).toBeTruthy();
  await press(view, '서울특별시');
  expect(get(view, '시·도 선택, 서울특별시').props.accessibilityState.expanded).toBe(false);
  await press(view, '역 터미널 검색');
  expect(get(view, '수서 NATH30000')).toBeTruthy();
  await press(view, '수서 NATH30000');
  await press(view, '도착 역·터미널 선택');
  await press(view, '시·도 선택');
  await press(view, '충청남도');
  await press(view, '역 터미널 검색');
  expect(get(view, '공주 NATH20438')).toBeTruthy();
  await press(view, '공주 NATH20438');
  const lookup = get(view, '운행편 조회').props.onPress;
  await act(async () => { lookup(); lookup(); });
  expect(getIntercityServices).toHaveBeenCalledTimes(1);
  return { view, close };
}
async function choose(onSelect: (selection: IntercitySelection, isCurrent: () => boolean) => Promise<void>) {
  const { view, close } = await lookupServices(onSelect);
  expect(get(view, '12:20 123 운행편 선택')).toBeTruthy();
  await press(view, '12:20 123 운행편 선택');
  return { view, close };
}
test('only upcoming rides reaching the terminal by the deadline are initially shown, including a ride arriving exactly at midnight', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-10-13T09:00+09:00'));
  const atMidnight = { ...service, id: 'midnight', trainNumber: '456', departureAt: '2099-10-13T23:00+09:00', arrivalAt: '2099-10-14T00:00+09:00' };
  const late = { ...atMidnight, id: 'late', trainNumber: '789', arrivalAt: '2099-10-14T00:01+09:00' };
  const departed = { ...service, id: 'past', trainNumber: '111', departureAt: '2099-10-13T09:00+09:00' };
  (getIntercityServices as jest.Mock).mockResolvedValue(page([departed, service, atMidnight, late]));
  const { view } = await lookupServices(jest.fn(), new Date('2099-10-13T15:00Z'));
  const toggle = '일정에 맞는 운행편만 보기';
  expect(get(view, toggle).props.accessibilityState.checked).toBe(true);
  expect(get(view, '23:00 456 운행편 선택').props.disabled).toBe(false);
  expect(() => get(view, '23:00 789 운행편 선택')).toThrow();
  expect(() => get(view, '09:00 111 운행편 선택')).toThrow();
  await press(view, toggle);
  expect(get(view, '23:00 789 운행편 선택').props.disabled).toBe(true);
  expect(get(view, '09:00 111 운행편 선택').props.disabled).toBe(true);
  expect(getIntercityServices).toHaveBeenCalledTimes(1);
});
test('a failed next page retains the deadline filter and can be retried, even with no matches on the first page', async () => {
  const late = { ...service, id: 'late', arrivalAt: '2099-10-13T15:18+09:00' };
  (getIntercityServices as jest.Mock)
    .mockResolvedValueOnce({ ...page([late]), hasMore: true })
    .mockResolvedValueOnce({ ...page([]), page: 2, status: 'RATE_LIMITED' })
    .mockResolvedValueOnce({ ...page([service]), page: 2, hasMore: true })
    .mockResolvedValueOnce({ ...page([]), page: 3, status: 'NO_SERVICES' });
  const { view } = await lookupServices(jest.fn(), new Date('2099-10-13T14:00+09:00'));
  const next = '다음 운행편 보기';
  const count = (n: number) => view.root.findAll(node => node.props.accessibilityLabel === `운행편 ${n}개`).length;
  expect(count(0)).toBeGreaterThan(0);
  await press(view, next);
  expect(count(0)).toBeGreaterThan(0);
  expect(get(view, '일정에 맞는 운행편만 보기').props.accessibilityState.checked).toBe(true);
  await press(view, next);
  expect(count(1)).toBeGreaterThan(0);
  await press(view, next);
  expect(count(1)).toBeGreaterThan(0);
  expect(() => get(view, next)).toThrow();
  expect((getIntercityServices as jest.Mock).mock.calls.map(([query]) => query.page)).toEqual([1, 2, 2, 3]);
});
test('lookup and row selection do not apply a journey until station mapping is confirmed', async () => {
  const select = jest.fn().mockResolvedValue(undefined);
  const { view, close } = await choose(select);
  expect(select).not.toHaveBeenCalled();
  await press(view, '이 운행편으로 경로 연결');
  expect(select).not.toHaveBeenCalled();
  await press(view, '같은 승하차 장소입니다');
  await press(view, '이 운행편으로 경로 연결');
  expect(close).toHaveBeenCalledTimes(1);
  expect(get(view, '이 운행편으로 경로 연결').props.accessibilityState.busy).toBe(false);
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ service, mappingConfirmed: true, boardingBufferMinutes: 15, alightingBufferMinutes: 5 }), expect.any(Function));
});
test('missing bus terminals expose the booking actions and a chosen terminal supplies the label for its exact ID', async () => {
  const dep = { id: 'NAI2238202', name: '인천공항2터미널' };
  const arr = { id: 'NAI2839701', name: '청주' };
  (getIntercityStops as jest.Mock).mockReset()
    .mockResolvedValueOnce({ ...page([]), status: 'NO_SERVICES' })
    .mockResolvedValueOnce(page([dep])).mockResolvedValueOnce(page([arr]));
  const bus = { ...service, kind: 'INTERCITY_BUS', departureId: dep.id, arrivalId: arr.id,
    departureName: dep.id, arrivalName: arr.name, trainNumber: null, grade: '심야우등' };
  (getIntercityServices as jest.Mock).mockResolvedValueOnce(page([bus]));
  const select = jest.fn().mockResolvedValue(undefined);
  let view!: ReactTestRenderer;
  await act(async () => { view = TestRenderer.create(<IntercityTimetableSheet kind="INTERCITY_BUS" date={new Date(service.departureAt)}
    departureName={dep.name} arrivalName={arr.name} dark={false} onClose={jest.fn()} onSelect={select} />); });
  await press(view, '출발 역·터미널 선택');
  await press(view, '역 터미널 검색');
  expect(get(view, '티머니GO 공식 예매 열기')).toBeTruthy();
  expect(get(view, '버스타고 공식 예매 열기')).toBeTruthy();
  await press(view, '역 터미널 검색');
  await press(view, `${dep.name} ${dep.id}`);
  await press(view, '도착 역·터미널 선택');
  await press(view, '역 터미널 검색');
  await press(view, `${arr.name} ${arr.id}`);
  await press(view, '운행편 조회');
  await press(view, '12:20 심야우등 운행편 선택');
  await press(view, '같은 승하차 장소입니다');
  await press(view, '이 운행편으로 경로 연결');
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ service: {
    ...bus, departureName: dep.name, arrivalName: arr.name,
  } }), expect.any(Function));
});
test('invalid buffers prevent a connection and returning restores the same service and buffers', async () => {
  const select = jest.fn().mockResolvedValue(undefined);
  const { view } = await choose(select);
  const input = (label: string) => view.root.findAll(node =>
    node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0];
  await act(async () => { input('하차 후 여유').props.onChangeText('121'); });
  await press(view, '같은 승하차 장소입니다');
  expect(get(view, '이 운행편으로 경로 연결').props.disabled).toBe(true);
  expect(view.root.findAll(node => node.props.accessibilityRole === 'alert'
    && [node.props.children].flat().join('') === '0~120분으로 입력해 주세요.').length).toBeGreaterThan(0);
  await press(view, '이 운행편으로 경로 연결');
  expect(select).not.toHaveBeenCalled();
  await press(view, '운행편 선택 취소');
  await press(view, '12:20 123 운행편 선택');
  expect(input('하차 후 여유').props.value).toBe('121');
  expect(get(view, '같은 승하차 장소입니다').props.accessibilityState.checked).toBe(false);
  await act(async () => { input('하차 후 여유').props.onChangeText('0'); });
  await press(view, '같은 승하차 장소입니다');
  await press(view, '이 운행편으로 경로 연결');
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ alightingBufferMinutes: 0 }), expect.any(Function));
});

test('reselecting the active transport keeps the stops and timetable results', async () => {
  const { view } = await choose(jest.fn().mockResolvedValue(undefined));
  await press(view, '운행편 선택 취소');
  await press(view, '기차');
  expect(get(view, '출발 수서')).toBeTruthy();
  expect(get(view, '도착 공주')).toBeTruthy();
  expect(get(view, '12:20 123 운행편 선택')).toBeTruthy();
  expect(getIntercityServices).toHaveBeenCalledTimes(1);
});

test('canceling a station search keeps each field’s query and region until transport changes', async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<IntercityTimetableSheet kind="TRAIN" date={new Date()} dark={false} departureName="수서" arrivalName="공주" onClose={jest.fn()} />);
  });
  const input = () => view.root.findAll(node => node.props.accessibilityLabel === '역 터미널 검색어'
    && typeof node.props.onChangeText === 'function')[0];
  await press(view, '출발 역·터미널 선택');
  await press(view, '시·도 선택');
  await press(view, '서울특별시');
  await act(async () => input().props.onChangeText('서울역'));
  await press(view, '역 터미널 선택 취소');
  await press(view, '도착 역·터미널 선택');
  expect(input().props.value).toBe('공주');
  expect(get(view, '시·도 선택')).toBeTruthy();
  expect(get(view, '역 터미널 검색').props.disabled).toBe(true);
  await press(view, '시·도 선택');
  await press(view, '충청남도');
  await act(async () => input().props.onChangeText('공주역'));
  await press(view, '역 터미널 선택 취소');
  await press(view, '출발 역·터미널 선택');
  expect(input().props.value).toBe('서울역');
  expect(get(view, '시·도 선택, 서울특별시')).toBeTruthy();
  await press(view, '역 터미널 선택 취소');
  await press(view, '도착 역·터미널 선택');
  expect(input().props.value).toBe('공주역');
  expect(get(view, '시·도 선택, 충청남도')).toBeTruthy();
  await press(view, '역 터미널 선택 취소');
  await press(view, '고속버스');
  await press(view, '출발 역·터미널 선택');
  expect(input().props.value).toBe('수서');
});

test('station lookup retry keeps the search text', async () => {
  const getDimensions = Dimensions.get.bind(Dimensions);
  jest.spyOn(Dimensions, 'get').mockImplementation(name => ({ ...getDimensions(name), fontScale: 1 }));
  const search = jest.mocked(getIntercityStops);
  search.mockReset()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({ ...page([{ id: 'NATH30000', name: '수서' }]), source: 'TAGO' as const, status: 'AVAILABLE' as const } as Awaited<ReturnType<typeof getIntercityStops>>);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<IntercityTimetableSheet kind="TRAIN" date={new Date()} dark={false} departureName="수서" onClose={jest.fn()} />);
  });
  await press(view, '출발 역·터미널 선택');
  await press(view, '시·도 선택');
  await press(view, '서울특별시');
  await press(view, '역 터미널 검색');
  expect(JSON.stringify(view.toJSON())).toContain('역 목록을 불러오지 못했어요.');
  expect(JSON.stringify(view.toJSON())).toContain('다시 시도');
  await press(view, '역 터미널 검색 다시 시도');
  expect(search).toHaveBeenNthCalledWith(2, expect.objectContaining({ query: '수서', cityCode: '11' }));
  expect(get(view, '수서 NATH30000')).toBeTruthy();
});

test('changes the Korean service day only when the calendar selection is applied', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const getDimensions = Dimensions.get.bind(Dimensions);
  jest.spyOn(Dimensions, 'get').mockImplementation(name => ({ ...getDimensions(name), fontScale: 1 }));
  const { view } = await choose(jest.fn().mockResolvedValue(undefined));
  await press(view, '운행편 선택 취소');
  const chooseNextDay = async () => {
    await press(view, '운행일, 2099-10-13');
    const picker = view.root.findByProps({ testID: 'intercity-service-date-picker' });
    expect(picker.props.timeZoneName).toBe('Asia/Seoul');
    await act(async () => {
      picker.props.onChange({ type: 'set' }, new Date('2099-10-13T15:00:00Z'));
    });
    expect(get(view, '운행편 조회').props.disabled).toBe(true);
  };
  await chooseNextDay();
  await press(view, '운행일 선택 취소');
  expect(get(view, '12:20 123 운행편 선택')).toBeTruthy();
  await chooseNextDay();
  await press(view, '운행일 적용');
  expect(get(view, '운행일, 2099-10-14')).toBeTruthy();
  expect(view.root.findAllByProps({ accessibilityLabel: '12:20 123 운행편 선택' })).toHaveLength(0);
  await press(view, '운행편 조회');
  expect(getIntercityServices).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2099-10-14' }));
});

test('explains an unsupported intercity bus date once and keeps both terminals selected', async () => {
  const getDimensions = Dimensions.get.bind(Dimensions);
  jest.spyOn(Dimensions, 'get').mockImplementation(name => ({ ...getDimensions(name), fontScale: 1 }));
  const policy = '시외버스 공공 시간표는 당일 배차만 제공합니다.';
  const unsupported = policy + ' 다른 날짜는 예매처에서 확인해 주세요.';
  jest.mocked(getIntercityStops).mockReset()
    .mockResolvedValueOnce({ ...page([]), status: 'AVAILABLE', source: 'TAGO', items: [{ id: 'NAI1', name: '인천공항T2' }] })
    .mockResolvedValueOnce({ ...page([]), status: 'AVAILABLE', source: 'TAGO', items: [{ id: 'NAI2', name: '청주터미널' }] });
  jest.mocked(getIntercityServices).mockReset()
    .mockResolvedValueOnce({ ...page([]), status: 'DATE_UNSUPPORTED', source: 'TAGO', items: [], message: unsupported });
  let view!: ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<IntercityTimetableSheet kind="INTERCITY_BUS" date={new Date('2099-10-14T00:00:00+09:00')}
      dark={false} departureName="인천공항T2" arrivalName="청주터미널" onClose={jest.fn()} />);
  });
  try {
    const policyMessages = () => view.root.findAllByType(Text).map(node => node.props.children)
      .filter(child => typeof child === 'string' && child.startsWith(policy));
    expect(policyMessages()).toEqual([policy]);
    await press(view, '출발 역·터미널 선택');
    await press(view, '역 터미널 검색');
    await press(view, '인천공항T2 NAI1');
    await press(view, '도착 역·터미널 선택');
    await press(view, '역 터미널 검색');
    await press(view, '청주터미널 NAI2');
    await press(view, '운행편 조회');
    expect(policyMessages()).toEqual([unsupported]);
    expect(get(view, '출발 인천공항T2')).toBeTruthy();
    expect(get(view, '도착 청주터미널')).toBeTruthy();
  } finally {
    await act(async () => view.unmount());
  }
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
  const ticket: ImportedTrainTicket = { version: 1, id: 'ticket:12345678-1234-1234-1234-123456789012', kind: 'TRAIN', source: 'IOS_SHARE_TEXT', verification: 'USER_CONFIRMED', bookingStatus: 'UNVERIFIED', departureName: '수서', arrivalName: '공주', departureAt: '2099-10-13T23:20:00+09:00', arrivalAt: '2099-10-14T00:12:00+09:00', trainNumber: '615', grade: 'SRT', confirmedAt: new Date().toISOString() };
  const select = jest.fn().mockResolvedValue(undefined); const close = jest.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = TestRenderer.create(<IntercityTimetableSheet importedTicket={ticket} kind="TRAIN" date={new Date()} dark={false} onClose={close} onSelect={select} />); });
  const shownTimes = () => view.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
  expect(shownTimes()).toContain('수서 → 공주 · 2099-10-13 23:20 → 10-14 00:12 · 615편');
  await press(view, '가져온 승차권으로 연결');
  expect(shownTimes()).toContain('23:20 → 10-14 00:12');
  await press(view, '이 운행편으로 경로 연결');
  expect(select).not.toHaveBeenCalled();
  await press(view, '같은 승하차 장소입니다');
  await press(view, '이 운행편으로 경로 연결');
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ service: expect.objectContaining({ timingBasis: 'TICKET', bookingStatus: 'UNVERIFIED', trainNumber: '615' }), alightingBufferMinutes: 0 }), expect.any(Function));
  expect(getIntercityServices).not.toHaveBeenCalled(); expect(getIntercityCities).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});
