import { acceptPushRoute, acceptedPushRouteToken, clearAcceptedPushRoute } from '../src/modules/notification/acceptedPushRoute';
import { configurePreparedJourneyRemoteUpdates, updatePreparedJourneyRemoteRegistration } from '../src/modules/journey/journeyRemoteUpdates';
import { configureAutomaticJourneyRemoteUpdates, updateAutomaticJourneyRemoteRegistration,
    type AutomaticJourneyBinding } from '../src/modules/journey/automaticJourney';
import type { JourneyAuthentication } from '../src/modules/journey/automaticJourneyAuthentication';

let mockCredentialRevision = 1, mockRegistrationGeneration = 1;
jest.mock('../src/modules/auth/authStorage', () => ({ getAuthCredentialRevision: () => mockCredentialRevision }));
jest.mock('../src/modules/notification/pushRegistrationCoordinator', () => ({ getPushRegistrationGeneration: () => mockRegistrationGeneration }));
jest.mock('../src/modules/journey/automaticJourney', () => ({
    configureAutomaticJourneyRemoteUpdates: jest.fn().mockResolvedValue(true),
    updateAutomaticJourneyRemoteRegistration: jest.fn().mockResolvedValue(true),
}));
const auth: JourneyAuthentication = { accessToken: 'not-persisted', authMemberId: 7, loginGeneration: 2,
    apiOrigin: 'https://api.example.test', expiresAtEpochSeconds: 1600 };
const binding = { syncScope: 'AUTHENTICATED', savedRouteValidated: true, guidanceEnabled: true,
    authMemberId: 7, loginGeneration: 2, apiOrigin: auth.apiOrigin } as AutomaticJourneyBinding;
const route = { memberId: 7, apiOrigin: auth.apiOrigin, credentialRevision: 1, registrationGeneration: 1, token: 'accepted-fcm' };
beforeEach(() => { jest.clearAllMocks(); clearAcceptedPushRoute(); mockCredentialRevision = 1; mockRegistrationGeneration = 1; });

test('only the current server-accepted registration is passed to native product configuration', async () => {
    await configurePreparedJourneyRemoteUpdates(auth, binding);
    expect(configureAutomaticJourneyRemoteUpdates).toHaveBeenLastCalledWith('');
    acceptPushRoute(route);
    await configurePreparedJourneyRemoteUpdates(auth, binding);
    expect(configureAutomaticJourneyRemoteUpdates).toHaveBeenLastCalledWith('accepted-fcm');
});
test.each([
    { memberId: 8 }, { apiOrigin: 'https://other.example.test' }, { credentialRevision: 0 }, { registrationGeneration: 0 },
])('another account, origin or registration generation cannot register remote updates: %j', async changed => {
    acceptPushRoute({ ...route, ...changed });
    await updatePreparedJourneyRemoteRegistration(auth, binding);
    expect(updateAutomaticJourneyRemoteRegistration).not.toHaveBeenCalled();
    expect(acceptedPushRouteToken(route)).toBeNull();
});
test('late accepted registration is attached to the exact prepared binding without requesting permission', async () => {
    await updatePreparedJourneyRemoteRegistration(auth, binding);
    expect(updateAutomaticJourneyRemoteRegistration).not.toHaveBeenCalled();
    acceptPushRoute(route);
    await updatePreparedJourneyRemoteRegistration(auth, binding);
    expect(updateAutomaticJourneyRemoteRegistration).toHaveBeenCalledWith('accepted-fcm', binding);
    mockCredentialRevision = 2;
    await updatePreparedJourneyRemoteRegistration(auth, binding);
    expect(updateAutomaticJourneyRemoteRegistration).toHaveBeenCalledTimes(1);
    mockCredentialRevision = 1; mockRegistrationGeneration = 2;
    await updatePreparedJourneyRemoteRegistration(auth, binding);
    expect(updateAutomaticJourneyRemoteRegistration).toHaveBeenCalledTimes(1);
});
test.each([{ ...binding, authMemberId: 8 }, { ...binding, loginGeneration: 3 }, { ...binding, syncScope: 'SANDBOX' }])(
    'a different journey ownership cannot consume an accepted token', async changed => {
        acceptPushRoute(route);
        await updatePreparedJourneyRemoteRegistration(auth, changed as AutomaticJourneyBinding);
        expect(updateAutomaticJourneyRemoteRegistration).not.toHaveBeenCalled();
    },
);
test('missing native support or a native failure does not fail otherwise eligible local guidance', async () => {
    jest.mocked(configureAutomaticJourneyRemoteUpdates).mockRejectedValueOnce(new Error('unavailable'));
    await expect(configurePreparedJourneyRemoteUpdates(auth, binding)).resolves.toBeUndefined();
    acceptPushRoute(route);
    jest.mocked(updateAutomaticJourneyRemoteRegistration).mockRejectedValueOnce(new Error('unavailable'));
    await expect(updatePreparedJourneyRemoteRegistration(auth, binding)).resolves.toBeUndefined();
    clearAcceptedPushRoute();
    expect(acceptedPushRouteToken(route)).toBeNull();
});
