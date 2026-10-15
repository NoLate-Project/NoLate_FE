import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, Linking, Platform } from 'react-native';
import BusBookingAction, { BUS_BOOKING_APP_URL, INTERCITY_BUS_BOOKING_URL, EXPRESS_BUS_BOOKING_URL, BUSTAGO_BOOKING_URL } from '../src/modules/schedule/components/route/BusBookingAction';

let view: TestRenderer.ReactTestRenderer;
const originalOS = Platform.OS;
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false); jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined); Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' }); });
afterEach(async () => { await act(async () => view?.unmount()); jest.restoreAllMocks(); Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }); });
const button = (name = '티머니GO') => view.root.findAll(node => node.props.accessibilityLabel === `${name} 공식 예매 열기` && typeof node.props.onPress === 'function')[0];
test.each([['INTERCITY_BUS', INTERCITY_BUS_BOOKING_URL], ['EXPRESS_BUS', EXPRESS_BUS_BOOKING_URL], ['COACH', INTERCITY_BUS_BOOKING_URL]])('absent app falls back to the correct official site for %s', async (kind, site) => {
    await act(async () => { view = TestRenderer.create(<BusBookingAction kind={kind} />); });
    await act(async () => { await button().props.onPress(); });
    expect(Linking.canOpenURL).toHaveBeenCalledWith(BUS_BOOKING_APP_URL);
    expect(Linking.openURL).toHaveBeenCalledWith(site);
});
test('installed bus app receives only a main-screen address', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    await act(async () => { view = TestRenderer.create(<BusBookingAction kind="INTERCITY_BUS" />); });
    await act(async () => { await button().props.onPress(); });
    expect(Linking.openURL).toHaveBeenCalledTimes(1); expect(Linking.openURL).toHaveBeenCalledWith('tmoneytia://main/home');
    expect(BUS_BOOKING_APP_URL).not.toMatch(/[?#]/);
});
test('query and app-launch failures retain the official website and allow a retry after failure', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('app')).mockRejectedValueOnce(new Error('web')).mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert');
    await act(async () => { view = TestRenderer.create(<BusBookingAction kind="INTERCITY_BUS" />); });
    await act(async () => { await button().props.onPress(); });
    expect(Linking.openURL).toHaveBeenNthCalledWith(2, INTERCITY_BUS_BOOKING_URL);
    expect(button().props.disabled).toBe(false);
    await act(async () => { alert.mock.calls[0][2]!.find(action => action.text === '다시 시도')!.onPress!(); });
    expect(Linking.openURL).toHaveBeenLastCalledWith(BUS_BOOKING_APP_URL);
});
test('unknown operator coverage offers Bustago without pretending it is the ticket issuer', async () => {
    await act(async () => { view = TestRenderer.create(<BusBookingAction kind="INTERCITY_BUS" />); });
    await act(async () => { await button('버스타고').props.onPress(); });
    expect(Linking.openURL).toHaveBeenCalledWith(BUSTAGO_BOOKING_URL);
    expect(Linking.canOpenURL).not.toHaveBeenCalled();
});
test('query allowlist exists in native and Expo configuration without registering carrier ownership', () => {
    const fs = require('node:fs'); const config = JSON.parse(fs.readFileSync('app.json', 'utf8'));
    const plist = fs.readFileSync('ios/NoLateFE/Info.plist', 'utf8');
    expect(config.ios.infoPlist.LSApplicationQueriesSchemes.filter((value: string) => value === 'tmoneytia')).toHaveLength(1);
    expect(plist.match(/<key>LSApplicationQueriesSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/)![1].match(/<string>tmoneytia<\/string>/g)).toHaveLength(1);
    expect(plist.match(/<key>CFBundleURLTypes<\/key>[\s\S]*?<key>LSApplicationQueriesSchemes/)![0]).not.toContain('<string>tmoneytia</string>');
});
