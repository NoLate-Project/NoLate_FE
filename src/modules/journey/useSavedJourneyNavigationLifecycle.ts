import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { subscribeAuthInvalidation } from '../auth/authStorage';
import {
    automaticRecord, getAutomaticJourneySnapshot, subscribeAutomaticJourney,
    type AutomaticJourneyBinding, type AutomaticJourneySnapshot,
} from './automaticJourney';
import { getAutomaticJourneyTrialBinding } from './automaticJourneyTrial';
import type { JourneyRouteInput } from './journeyRouteInput';
import { savedWalkingBaseJSON } from './serverWalkingSnapshot';
import { useSavedJourneyBinding } from './useSavedJourneyBinding';

type OwnedSession = { key: string; binding: AutomaticJourneyBinding };
type NavigationEnd = {
    scheduleId: string; sessionId: string; status: 'STOPPED' | 'EXPIRED'; reason: string;
};
type ObservedEnd = OwnedSession & { value: NavigationEnd };
const identityKeys = ['sessionId', 'scheduleId', 'generation', 'routeRevision', 'routeInputDigest'] as const;

/** Read-only lifecycle for the whole detail screen, independent of its settings sheet.
 * The last observed owned binding survives coordinator cleanup, but never a route/account change. */
export function useSavedJourneyNavigationLifecycle(input: JourneyRouteInput | null,
    scheduleId: string, memberId: number | null | undefined) {
    const binding = useSavedJourneyBinding(input, scheduleId);
    const route = useMemo(() => input ? savedWalkingBaseJSON(input) : null, [input]);
    const key = route && memberId != null ? JSON.stringify([scheduleId, memberId, route]) : null;
    const isOwned = (candidate: AutomaticJourneyBinding | null) => candidate?.scheduleId === scheduleId
        && candidate.syncScope === 'AUTHENTICATED' && candidate.authMemberId === memberId
        && candidate.savedRouteValidated === true && candidate.guidanceEnabled === true;
    const ownedBinding = isOwned(binding) ? binding : null;
    const lastOwned = useRef<OwnedSession | null>(null);
    const [ended, setEnded] = useState<ObservedEnd | null>(null);
    useLayoutEffect(() => {
        if (lastOwned.current?.key !== key) lastOwned.current = null;
        if (key && ownedBinding) lastOwned.current = { key, binding: ownedBinding };
    }, [key, ownedBinding]);
    useEffect(() => {
        if (!key) return;
        return subscribeAuthInvalidation(() => { lastOwned.current = null; setEnded(null); });
    }, [key]);
    const owner = ownedBinding ?? (lastOwned.current?.key === key ? lastOwned.current.binding : null);
    const navigationEnd = ended?.key === key && owner
        && identityKeys.every(field => ended.binding[field] === owner[field]) ? ended.value : undefined;
    const observe = !!key && !!owner && !navigationEnd;
    useEffect(() => {
        if (!observe || !input || !key) return;
        let active = true, eventRevision = 0, readRevision = 0;
        const accept = (snapshot: AutomaticJourneySnapshot) => {
            if (!active || lastOwned.current?.key !== key) return;
            const current = getAutomaticJourneyTrialBinding(input);
            // A replacement may be published before React commits its new binding.
            if (current?.scheduleId === scheduleId && current.syncScope === 'AUTHENTICATED'
                && current.authMemberId === memberId && current.savedRouteValidated && current.guidanceEnabled) {
                lastOwned.current = { key, binding: current };
            }
            const selected = lastOwned.current;
            const raw = automaticRecord(snapshot.guidance);
            if (!selected || !raw || snapshot.guidanceMemberId !== memberId
                || snapshot.syncScope !== 'AUTHENTICATED' || snapshot.sessionId !== selected.binding.sessionId
                || snapshot.routeRevision !== selected.binding.routeRevision
                || !identityKeys.every(field => raw[field] === selected.binding[field])
                || raw.status !== snapshot.status || !['STOPPED', 'EXPIRED'].includes(snapshot.status)) return;
            const value: NavigationEnd = { scheduleId, sessionId: selected.binding.sessionId,
                status: snapshot.status as NavigationEnd['status'], reason: snapshot.qualityReason };
            // Cleanup can publish another STOPPED. Keep the first owned terminal result,
            // including DESTINATION_ARRIVED, instead of replacing it with a later stop reason.
            setEnded(previous => previous?.key === key
                && identityKeys.every(field => previous.binding[field] === selected.binding[field])
                ? previous : { ...selected, value });
        };
        const read = () => {
            const request = ++readRevision, beforeEvents = eventRevision;
            getAutomaticJourneySnapshot().then(snapshot => {
                if (active && request === readRevision && beforeEvents === eventRevision) accept(snapshot);
            }).catch(() => undefined);
        };
        const detach = subscribeAutomaticJourney(snapshot => { ++eventRevision; accept(snapshot); });
        const foreground = AppState.addEventListener('change', state => { if (state === 'active') read(); });
        const timer = setInterval(() => { if (AppState.currentState === 'active') read(); }, 2000);
        read();
        return () => { active = false; detach(); foreground.remove(); clearInterval(timer); };
    }, [input, key, memberId, observe, scheduleId]);
    const sessionObserved = !!key && !!owner;
    return { binding: ownedBinding, navigationEnd, sessionObserved,
        navigationReconciling: sessionObserved && !ownedBinding && !navigationEnd };
}
