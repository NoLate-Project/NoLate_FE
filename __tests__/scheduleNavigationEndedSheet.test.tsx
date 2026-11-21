import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { ScheduleDetailRouteSheet } from '../src/routeSupport/schedule/ScheduleDetailRouteSheet';
import type { ScheduleDetailPresentation } from '../src/routeSupport/schedule/scheduleDetailPresentationModel';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../src/modules/journey/journeyFeature', () => ({ isAutomaticJourneyEntryEnabled: () => true }));
jest.mock('../src/modules/journey/useSavedJourneyGuidanceView', () => ({ useSavedJourneyGuidanceView: () => ({}) }));
jest.mock('../src/modules/journey/SavedJourneyTrialControls', () => ({ SavedJourneyTrialControls: () => null }));
jest.mock('../src/modules/journey/SavedJourneyRouteTimeline', () => ({ SavedJourneyRouteTimeline: () => null }));
jest.mock('../src/modules/schedule/components/detail/ScheduleSharingInformation', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/modules/schedule/components/detail/ImportedTicketSummary', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/routeSupport/schedule/ScheduleDetailRouteQuickSummary', () => ({
    ScheduleDetailRouteQuickSummary: () => null,
}));

function presentation(reason?: string): ScheduleDetailPresentation {
    return {
        currentMemberId: 7, authoritativeDetailLoaded: true, navigationMode: true, isPlainSchedule: false,
        item: { id: '363', ownerMemberId: 7, travelMode: 'TRANSIT' },
        navigationEnd: reason ? { scheduleId: '363', reason } : undefined,
        departureOverview: { departedCount: 0 }, participantPresentations: [], routeFactLabels: [],
        primaryText: '#111', secondaryText: '#555', topCardAccentText: '#2979FF',
        sheetMode: 'compact', sheetMaxHeight: 480, sheetBottomPadding: 34, sheetTranslateY: 0,
        sheetPanResponder: { panHandlers: {} }, sheetScrollRef: { current: null },
        snapSheet: jest.fn(),
    } as unknown as ScheduleDetailPresentation;
}

test.each([undefined, 'DESTINATION_ARRIVED', 'STOPPED', 'EXPIRED'])(
    'only an unstarted navigation offers preparation, terminal reason=%s', reason => {
        let view!: ReactTestRenderer;
        act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet presentation={presentation(reason)}
            companionCount={1} renderRouteCompanions={() => null} />); });
        expect(view.root.findAllByProps({ testID: 'schedule-route-guidance-entry' }).length > 0).toBe(reason === undefined);
        act(() => view.unmount());
    },
);

test('an authenticated ended Live Activity handoff cannot offer new guidance preparation', () => {
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet
        presentation={{ ...presentation(), guidanceEndedHandoff: true }}
        companionCount={1} renderRouteCompanions={() => null} />); });
    expect(view.root.findAllByProps({ testID: 'schedule-route-guidance-entry' })).toHaveLength(0);
    act(() => view.unmount());
});

test('coordinator cleanup waits for the owned terminal snapshot without offering a new preparation', () => {
    let view!: ReactTestRenderer;
    act(() => { view = TestRenderer.create(<ScheduleDetailRouteSheet
        presentation={{ ...presentation(), navigationReconciling: true }}
        companionCount={1} renderRouteCompanions={() => null} />); });
    expect(view.root.findAllByProps({ testID: 'schedule-route-guidance-entry' })).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).toContain('안내 상태를 확인 중이에요');
    act(() => view.unmount());
});
