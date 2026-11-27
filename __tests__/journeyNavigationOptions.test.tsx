import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { JourneyNavigationOptions } from '../src/modules/journey/JourneyNavigationOptions';
import { configureAutomaticJourneyNoticeMode, getAutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/modules/performance/useSystemReduceMotion', () => ({ useSystemReduceMotion: () => false }));
jest.mock('../src/modules/journey/automaticJourney', () => ({
    configureAutomaticJourneyNoticeMode: jest.fn(), getAutomaticJourneySnapshot: jest.fn(),
}));

let view: ReactTestRenderer;
beforeEach(() => {
    jest.clearAllMocks();
    (getAutomaticJourneySnapshot as jest.Mock).mockResolvedValue({ guidanceNoticeMode: 'OFF', guidanceNoticePermission: 'GRANTED' });
    (configureAutomaticJourneyNoticeMode as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => { act(() => view?.unmount()); });
async function render(props: Partial<React.ComponentProps<typeof JourneyNavigationOptions>> = {}) {
    await act(async () => { view = TestRenderer.create(<JourneyNavigationOptions dark={false} onClose={jest.fn()} sessionId="owned-session" {...props} />); });
}
async function toggle(id: string, value: boolean) {
    await act(async () => { view.root.findByProps({ testID: id }).props.onValueChange(value); });
}
test('voice and notification switches persist supported modes for the same owned session', async () => {
    await render();
    expect(configureAutomaticJourneyNoticeMode).not.toHaveBeenCalled();
    await toggle('journey-option-voice', true);
    expect(configureAutomaticJourneyNoticeMode).toHaveBeenLastCalledWith('VOICE_AND_NOTIFICATIONS', 'owned-session');
    expect(view.root.findByProps({ testID: 'journey-option-notifications' }).props.value).toBe(true);
    await toggle('journey-option-voice', false);
    expect(configureAutomaticJourneyNoticeMode).toHaveBeenLastCalledWith('NOTIFICATIONS', 'owned-session');
    await toggle('journey-option-notifications', false);
    expect(configureAutomaticJourneyNoticeMode).toHaveBeenLastCalledWith('OFF', 'owned-session');
    expect(view.root.findByProps({ testID: 'journey-option-voice' }).props.value).toBe(false);
});
test('a rejected preference keeps the previous switch value and exposes recovery feedback', async () => {
    await render();
    (configureAutomaticJourneyNoticeMode as jest.Mock).mockRejectedValueOnce(new Error('rejected'));
    await toggle('journey-option-voice', true);
    expect(view.root.findByProps({ testID: 'journey-option-voice' }).props.value).toBe(false);
    expect(JSON.stringify(view.toJSON())).toContain('변경을 적용하지 못했어요');
});
test('the stop action waits for the owned callback and the modal stays dismissible afterwards', async () => {
    const stop = jest.fn().mockResolvedValue(undefined), close = jest.fn();
    await render({ onStop: stop, onClose: close });
    await act(async () => { view.root.findByProps({ testID: 'saved-detail-stop' }).props.onPress(); });
    expect(stop).toHaveBeenCalledTimes(1);
    act(() => view.root.findByProps({ testID: 'journey-options-close' }).props.onPress());
    expect(close).toHaveBeenCalledTimes(1);
});
