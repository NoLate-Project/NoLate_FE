import React from 'react';
import { Linking } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { JourneyNoticeControls } from '../src/modules/journey/JourneyNoticeControls';
const mockConfigure = jest.fn();
const mockPermission = jest.fn();
jest.mock('../src/modules/journey/automaticJourney', () => ({ configureAutomaticJourneyNoticeMode: (...args: unknown[]) => mockConfigure(...args) }));
jest.mock('../src/modules/notification/pushPermission', () => ({ requestPushNotificationPermission: () => mockPermission() }));

let view: ReactTestRenderer;
const refresh = jest.fn();
beforeEach(() => { jest.clearAllMocks(); mockConfigure.mockResolvedValue(undefined); mockPermission.mockResolvedValue(true); refresh.mockResolvedValue(undefined); });
afterEach(() => { act(() => view?.unmount()); jest.restoreAllMocks(); });
async function render(running = false, pending = false) {
    await act(async () => { view = TestRenderer.create(<JourneyNoticeControls running={running} pending={pending} refresh={refresh} />); });
}
async function click(id: string) {
    await act(async () => { view.root.findByProps({ testID: `saved-guidance-${id}` }).props.onPress(); });
}
it('rendering never requests permissions, configures channels or opens settings', async () => {
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render();
    expect(mockPermission).not.toHaveBeenCalled(); expect(mockConfigure).not.toHaveBeenCalled(); expect(settings).not.toHaveBeenCalled();
});
it('product settings are collapsed and expose only an accessible current-mode disclosure until tapped', async () => {
    await act(async()=>{view=TestRenderer.create(<JourneyNoticeControls compact running={false} pending={false} refresh={refresh} selectedMode="NOTIFICATIONS"/>);});
    expect(view.root.findAllByProps({testID:'saved-guidance-notice-options'})).toHaveLength(0);
    expect(view.root.findByProps({testID:'saved-guidance-notice-expand'}).props.accessibilityLabel).toContain('알림 안내');
    await click('notice-expand');
    expect(view.root.findByProps({testID:'saved-guidance-notice-expand'}).props.accessibilityState.expanded).toBe(true);
    expect(view.root.findByProps({testID:'saved-guidance-notice-notifications'}).props.accessibilityState.selected).toBe(true);
    expect(mockPermission).not.toHaveBeenCalled(); expect(mockConfigure).not.toHaveBeenCalled();
});
it('reports in-flight action so the enclosing prepare action cannot race a channel choice', async () => {
    const changed=jest.fn();let done!:()=>void;
    mockConfigure.mockImplementation(()=>new Promise<void>(resolve=>{done=resolve;}));
    await act(async()=>{view=TestRenderer.create(<JourneyNoticeControls running={false} pending={false} refresh={refresh} onPendingChange={changed}/>);});
    await click('notice-voice'); expect(changed).toHaveBeenLastCalledWith(true);
    await click('notice-off'); expect(mockConfigure).toHaveBeenCalledTimes(1);
    await act(async()=>done()); expect(changed).toHaveBeenLastCalledWith(false);
    expect(view.root.findByProps({testID:'saved-guidance-notice-voice'}).props.accessibilityState.selected).toBe(true);
});
it('collapsed selected channel still warns when lock-screen notices are not permitted',async()=>{
    await act(async()=>{view=TestRenderer.create(<JourneyNoticeControls compact running={false} pending={false} refresh={refresh}
        selectedMode="VOICE_AND_NOTIFICATIONS" permission="NOT_DETERMINED_LOCK_UNSUPPORTED_ALERT_UNSUPPORTED"/>);});
    expect(view.root.findAllByProps({testID:'saved-guidance-notice-options'})).toHaveLength(0);
    expect(JSON.stringify(view.root.findByProps({testID:'saved-guidance-notice-availability'}).props.children)).toContain('받을 수 없어요');
    expect(mockPermission).not.toHaveBeenCalled();expect(mockConfigure).not.toHaveBeenCalled();
});
it('a new permission grant does not reuse stale not-determined metadata or promise lock delivery',async()=>{
    await act(async()=>{view=TestRenderer.create(<JourneyNoticeControls running={false} pending={false} refresh={refresh}
        selectedMode="NOTIFICATIONS" permission="NOT_DETERMINED_LOCK_UNSUPPORTED_ALERT_UNSUPPORTED"/>);});
    await click('notice-permission');
    const text=JSON.stringify(view.root.findByProps({testID:'saved-guidance-notice-availability'}).props.children);
    expect(text).toContain('확인해 주세요');expect(text).not.toContain('아직 허용하지');
    expect(text).not.toContain('허용됨');expect(mockConfigure).not.toHaveBeenCalled();
});
it('hides actions during an active journey and disables them while another action is pending', async () => {
    await render(true); expect(view.toJSON()).toBeNull();
    await render(false, true);
    expect(view.root.findByProps({ testID: 'saved-guidance-notice-permission' }).props.disabled).toBe(true);
    await click('notice-permission'); expect(mockPermission).not.toHaveBeenCalled();
});
it.each([true, false])('permission is an explicit action separate from channel and token registration: %s', async granted => {
    mockPermission.mockResolvedValue(granted); await render(); await click('notice-permission');
    expect(mockPermission).toHaveBeenCalledTimes(1); expect(mockConfigure).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain(granted ? 'PERMISSION_GRANTED' : 'PERMISSION_NOT_GRANTED');
});
it('opens only the app settings through the platform API after the explicit tap', async () => {
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render(); await click('notice-settings'); expect(settings).toHaveBeenCalledTimes(1); expect(mockPermission).not.toHaveBeenCalled();
});
it.each([['notice-notifications', 'NOTIFICATIONS'], ['notice-voice', 'VOICE_AND_NOTIFICATIONS'], ['notice-off', 'OFF']])('changes only the selected channel: %s', async (id, mode) => {
    await render(); await click(id);
    expect(mockConfigure).toHaveBeenCalledWith(mode); expect(refresh).toHaveBeenCalledTimes(1); expect(mockPermission).not.toHaveBeenCalled();
});
it('redacts failure and prevents concurrent permission requests', async () => {
    let reject!: (error: Error) => void;
    mockPermission.mockImplementation(() => new Promise((_, failure) => { reject = failure; }));
    await render(); await click('notice-permission'); await click('notice-permission');
    expect(mockPermission).toHaveBeenCalledTimes(1);
    await act(async () => { reject(new Error('private raw transport value')); });
    const text = JSON.stringify(view.toJSON()); expect(text).toContain('NOTICE_ACTION_UNAVAILABLE'); expect(text).not.toContain('private raw');
});
