import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Linking, Platform } from 'react-native';
import TrainBookingAction, { TRAIN_BOOKING_APP_URL, TRAIN_BOOKING_URL } from '../src/modules/schedule/components/route/TrainBookingAction';
import IntercityTimetableSheet from '../src/modules/schedule/components/route/IntercityTimetableSheet';
import ImportedTicketSummary from '../src/modules/schedule/components/detail/ImportedTicketSummary';

jest.mock('../src/api/intercityTimetable', () => ({ getIntercityCities: jest.fn(), getIntercityServices: jest.fn(), getIntercityStops: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/modules/theme/ThemeContext', () => ({ useTheme: () => ({ mode: 'light', colors: { surface2: '#fff', border: '#ddd', textPrimary: '#111', textSecondary: '#555' } }) }));

let view: ReactTestRenderer;
const originalOS = Platform.OS;
beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
});
afterEach(async () => {
    await act(async () => view?.unmount());
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
});
const button = () => view.root.findAll(node => node.props.accessibilityLabel === '코레일 공식 예매 열기' && typeof node.props.onPress === 'function')[0];

test('opening the official HTTPS site does not apply or dismiss the current timetable selection', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const select = jest.fn(); const close = jest.fn();
    await act(async () => { view = TestRenderer.create(<IntercityTimetableSheet kind="TRAIN" date={new Date()} dark={false} departureName="서울" arrivalName="부산" onClose={close} onSelect={select} />); });
    await act(async () => { button().props.onPress(); });
    expect(open).toHaveBeenCalledWith('https://www.korail.com/');
    expect(select).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(button().props.disabled).toBe(false);
});

test('installed app opens its main screen once without also opening the website or changing a selection', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const select = jest.fn(); const close = jest.fn();
    await act(async () => { view = TestRenderer.create(<IntercityTimetableSheet kind="TRAIN" date={new Date()} dark={false} onClose={close} onSelect={select} />); });
    await act(async () => { await button().props.onPress(); });
    expect(Linking.canOpenURL).toHaveBeenCalledWith(TRAIN_BOOKING_APP_URL);
    expect(open.mock.calls).toEqual([[TRAIN_BOOKING_APP_URL]]);
    expect(TRAIN_BOOKING_APP_URL).not.toMatch(/[?#]/);
    expect(select).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});

test.each(['query', 'launch'])('app %s failure falls back to the official website', async failure => {
    const query = jest.spyOn(Linking, 'canOpenURL');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    if (failure === 'query') query.mockRejectedValue(new Error('Query unavailable'));
    else { query.mockResolvedValue(true); open.mockRejectedValueOnce(new Error('App launch failed')); }
    const alert = jest.spyOn(Alert, 'alert');
    await act(async () => { view = TestRenderer.create(<TrainBookingAction />); });
    await act(async () => { await button().props.onPress(); });
    expect(open.mock.calls).toEqual(failure === 'query' ? [[TRAIN_BOOKING_URL]] : [[TRAIN_BOOKING_APP_URL], [TRAIN_BOOKING_URL]]);
    expect(alert).not.toHaveBeenCalled(); expect(button().props.disabled).toBe(false);
});

test('duplicate taps while installation detection is pending cannot launch twice', async () => {
    let installed!: (value: boolean) => void;
    jest.spyOn(Linking, 'canOpenURL').mockImplementation(() => new Promise(resolve => { installed = resolve; }));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await act(async () => { view = TestRenderer.create(<TrainBookingAction />); });
    await act(async () => { button().props.onPress(); button().props.onPress(); });
    expect(Linking.canOpenURL).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled(); expect(button().props.disabled).toBe(true);
    await act(async () => { installed(true); });
    expect(open.mock.calls).toEqual([[TRAIN_BOOKING_APP_URL]]);
    expect(button().props.disabled).toBe(false);
});

test('native and Expo configuration both allow querying the app without claiming its URL scheme', () => {
    const fs = require('node:fs');
    const config = JSON.parse(fs.readFileSync('app.json', 'utf8'));
    const plist = fs.readFileSync('ios/NoLateFE/Info.plist', 'utf8');
    expect(config.ios.infoPlist.LSApplicationQueriesSchemes.filter((scheme: string) => scheme === 'korailtalk')).toHaveLength(1);
    const querySection = plist.match(/<key>LSApplicationQueriesSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/)![1];
    expect(querySection.match(/<string>korailtalk<\/string>/g)).toHaveLength(1);
    const registeredSchemes = plist.match(/<key>CFBundleURLTypes<\/key>[\s\S]*?<key>LSApplicationQueriesSchemes/)![0];
    expect(registeredSchemes).not.toContain('<string>korailtalk</string>');
});

test('rapid duplicate taps open one browser and failure offers a working retry', async () => {
    let fail!: (cause: Error) => void;
    const open = jest.spyOn(Linking, 'openURL').mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; })).mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert');
    await act(async () => { view = TestRenderer.create(<TrainBookingAction />); });
    await act(async () => { button().props.onPress(); button().props.onPress(); });
    expect(open).toHaveBeenCalledTimes(1); expect(button().props.disabled).toBe(true);
    await act(async () => { fail(new Error('Cannot open URL')); });
    expect(button().props.disabled).toBe(false);
    expect(alert).toHaveBeenCalledWith('예매 페이지를 열지 못했어요', expect.any(String), expect.any(Array));
    const retry = alert.mock.calls[0][2]!.find(action => action.text === '다시 시도')!;
    await act(async () => { retry.onPress!(); });
    expect(open).toHaveBeenCalledTimes(2); expect(button().props.disabled).toBe(false);
});

test('Android remains deferred and bus timetables do not link to a train booking site', async () => {
    await act(async () => { view = TestRenderer.create(<IntercityTimetableSheet kind="INTERCITY_BUS" date={new Date()} dark={false} onClose={jest.fn()} />); });
    expect(button()).toBeUndefined();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    await act(async () => view.update(<TrainBookingAction />));
    expect(view.toJSON()).toBeNull();
});

test('collapsed saved-ticket summary keeps the expansion control reachable by deferring its booking action', async () => {
    const route = { importedTicket: { version: 1, id: 'ticket:12345678-1234-1234-1234-123456789012', kind: 'TRAIN', source: 'IOS_SHARE_IMAGE', verification: 'USER_CONFIRMED', bookingStatus: 'UNVERIFIED', departureName: '수서', arrivalName: '공주', departureAt: '2099-10-13T12:20:00+09:00', arrivalAt: '2099-10-13T13:12:00+09:00', trainNumber: '615', confirmedAt: '2099-10-12T12:00:00+09:00' } };
    await act(async () => { view = TestRenderer.create(<ImportedTicketSummary route={route} showBooking={false} />); });
    expect(button()).toBeUndefined();
    expect(JSON.stringify(view.toJSON())).toContain('예매 상태 미검증');
    await act(async () => view.update(<ImportedTicketSummary route={route} showBooking />));
    expect(button()).toBeDefined();
});
