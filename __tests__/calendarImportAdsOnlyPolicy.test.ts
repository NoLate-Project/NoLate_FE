import { createCalendarImportActions } from '../src/routeSupport/onboarding/calendarImportActions';
import { createImportedSchedule } from '../src/routeSupport/onboarding/calendarImportModel';
import { enrichCalendarCandidateWithRoute } from '../src/modules/onboarding/calendarImportRouteEnrichment';

jest.mock('../src/modules/map/routingService', () => ({
    getRouteAlternativeOptions: jest.fn(), searchAddressByKeyword: jest.fn(),
}));
jest.mock('../src/modules/onboarding/calendarConnectionStorage', () => ({
    recordCalendarImportCompleted: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/modules/onboarding/calendarImportAlarmRecoveryBatch', () => ({
    createCalendarImportAlarmRecoveryBatch: () => ({
        run: (work: () => Promise<unknown>) => work(),
        finish: jest.fn().mockResolvedValue(undefined),
    }),
}));
jest.mock('../src/modules/onboarding/calendarImportRouteEnrichment', () => ({
    ...jest.requireActual('../src/modules/onboarding/calendarImportRouteEnrichment'),
    enrichCalendarCandidateWithRoute: jest.fn(),
}));
jest.mock('../src/routeSupport/onboarding/calendarImportModel', () => ({
    IMPORT_BATCH_SIZE: 3,
    createImportedSchedule: jest.fn(),
    getErrorMessage: () => 'error',
}));

test('all 102 eligible imported schedules receive notifications beyond both former quotas', async () => {
    const category = { id: '1', title: '개인', color: '#2196f3' };
    const candidates = Array.from({ length: 102 }, (_, index) => ({
        id: `event-${index}`, eventId: `event-${index}`, provider: 'APPLE_DEVICE' as const,
        calendarId: 'calendar', calendarTitle: '개인', title: '회의',
        startAt: '2099-01-02T12:00:00.000Z', endAt: '2099-01-02T13:00:00.000Z',
        allDay: false, requiresTimeReview: false,
    }));
    jest.mocked(enrichCalendarCandidateWithRoute).mockResolvedValue({
        payload: {
            title: '회의', startAt: candidates[0].startAt, endAt: candidates[0].endAt,
            category, allDay: false, travelMode: 'CAR', travelMinutes: 30,
            origin: { name: '집', lat: 37.5, lng: 127 },
            destination: { name: '회사', lat: 37.6, lng: 127 },
            route: { id: 'route', mode: 'CAR', minutes: 30 },
        },
        routePrepared: true, hints: {},
    });
    jest.mocked(createImportedSchedule).mockImplementation(async (candidate, payload) => ({
        item: { ...payload, id: candidate.id }, created: true, notificationEnabled: true,
    }));
    const setNotificationReadyCount = jest.fn();
    const goToStep = jest.fn();
    const actions = createCalendarImportActions({
        selectedCategory: category, selectedCandidates: candidates, routesReadyForImport: true,
        importing: false, categoryCreating: false, travelMode: 'CAR', travelMinutes: 30,
        categories: [category], categoryId: '1', categoryIdBySource: {},
        defaultOrigin: { name: '집', lat: 37.5, lng: 127 }, dispatch: jest.fn(),
        setImporting: jest.fn(), setImportProgress: jest.fn(), setAlreadyImportedCount: jest.fn(),
        setPreparedRouteCount: jest.fn(), setNotificationReadyCount, setFailedImportCount: jest.fn(),
        setLastImportPreparedRoutes: jest.fn(), setImportedCount: jest.fn(),
        persistCurationCompletion: jest.fn().mockResolvedValue(undefined), goToStep,
    });
    await actions.importSelectedSchedules();
    expect(enrichCalendarCandidateWithRoute).toHaveBeenCalledTimes(102);
    expect(createImportedSchedule).toHaveBeenCalledTimes(102);
    for (const [, payload] of jest.mocked(createImportedSchedule).mock.calls) {
        expect(payload).toMatchObject({ notificationEnabled: true, notificationIntervalMinutes: 10 });
    }
    expect(setNotificationReadyCount).toHaveBeenLastCalledWith(102);
    expect(goToStep).toHaveBeenCalledWith('complete');
});
