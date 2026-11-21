import { getAuthCredentialRevision } from '../auth/authStorage';
import { acceptedPushRouteToken } from '../notification/acceptedPushRoute';
import { getPushRegistrationGeneration } from '../notification/pushRegistrationCoordinator';
import { configureAutomaticJourneyRemoteUpdates, updateAutomaticJourneyRemoteRegistration,
    type AutomaticJourneyBinding } from './automaticJourney';
import type { JourneyAuthentication } from './automaticJourneyAuthentication';

function token(auth: JourneyAuthentication, binding: AutomaticJourneyBinding): string | null {
    if (binding.syncScope !== 'AUTHENTICATED' || !binding.savedRouteValidated || !binding.guidanceEnabled
        || binding.authMemberId !== auth.authMemberId || binding.apiOrigin !== auth.apiOrigin
        || binding.loginGeneration !== auth.loginGeneration) return null;
    return acceptedPushRouteToken({ memberId: auth.authMemberId, apiOrigin: auth.apiOrigin,
        credentialRevision: getAuthCredentialRevision(), registrationGeneration: getPushRegistrationGeneration() });
}
/** No permission prompts, SDK initialization, raw-token persistence or network fallback here. */
export async function configurePreparedJourneyRemoteUpdates(auth: JourneyAuthentication, binding: AutomaticJourneyBinding): Promise<void> {
    if (binding.syncScope !== 'AUTHENTICATED' || !binding.savedRouteValidated || !binding.guidanceEnabled) return;
    await configureAutomaticJourneyRemoteUpdates(token(auth, binding) ?? '').catch(() => false);
}
export async function updatePreparedJourneyRemoteRegistration(auth: JourneyAuthentication, binding: AutomaticJourneyBinding): Promise<void> {
    const accepted = token(auth, binding);
    if (accepted) await updateAutomaticJourneyRemoteRegistration(accepted, binding).catch(() => false);
}
