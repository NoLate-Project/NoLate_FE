import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Linking } from 'react-native';
import {
    automaticUUID,
    getAutomaticJourneySnapshot,
    subscribeAutomaticJourney,
    type AutomaticJourneySnapshot,
} from './automaticJourney';
import {
    getAutomaticJourneySyncState,
    subscribeAutomaticJourneySync,
    type SavedJourneyCheckpoint,
} from './automaticJourneyTrial';

type HandoffState = 'live' | 'resume' | 'ended' | 'schedule';

const getValidatedCheckpoint = () => {
    const { checkpointState, savedCheckpoint } = getAutomaticJourneySyncState();
    return checkpointState === 'CURRENT' ? savedCheckpoint : undefined;
};

/** Live Activity emits this canonical URL. Match the exact schedule and session on a repeat tap. */
export function isSameGuidanceActivityLink(url: string, scheduleId: string, sessionId: string): boolean {
    const match = /^nolate:\/\/schedule\/([1-9]\d{0,15})\?entrySource=guidance-activity&guidanceSession=([\da-f-]+)$/i.exec(url);
    return match?.[1] === scheduleId && automaticUUID(match[2]) && match[2].toLowerCase() === sessionId.toLowerCase();
}

export function useGuidanceActivityRepeatTap(scheduleId?: string, sessionId?: string): number {
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (!scheduleId || !automaticUUID(sessionId)) return;
        const subscription = Linking.addEventListener('url', ({ url }) => {
            if (isSameGuidanceActivityLink(url, scheduleId, sessionId)) setCount(value => value + 1);
        });
        return () => subscription.remove();
    }, [scheduleId, sessionId]);
    return count;
}

export function resolveGuidanceActivityHandoff(
    snapshot: AutomaticJourneySnapshot | null,
    sessionId: string | undefined,
    scheduleId: string | undefined,
    memberId: number | null,
    checkpoint?: SavedJourneyCheckpoint,
): HandoffState {
    if (!snapshot?.enabled || !automaticUUID(sessionId) || !scheduleId || memberId == null) return 'schedule';
    if (snapshot.status === 'IDLE' && snapshot.checkpointAvailable && checkpoint?.memberId === memberId
        && checkpoint.scheduleId === scheduleId && checkpoint.sessionId.toLowerCase() === sessionId.toLowerCase()
        && checkpoint.expiresAt > Date.now() / 1000) return 'resume';
    if (snapshot.guidanceMemberId !== memberId
        || snapshot.sessionId?.toLowerCase() !== sessionId.toLowerCase()
        || snapshot.guidance?.scheduleId !== scheduleId) return 'schedule';
    if (snapshot.status === 'STOPPED' || snapshot.status === 'EXPIRED') return 'ended';
    return snapshot.status === 'ACTIVE' || snapshot.status === 'ARMED' ? 'live' : 'schedule';
}

/** A tap only reads local guidance state. It never starts or restores a trip. */
export function useGuidanceActivityHandoff(
    sessionId: string | undefined,
    scheduleId: string | undefined,
    memberId: number | null,
): HandoffState | 'pending' {
    const key = automaticUUID(sessionId) && scheduleId && memberId != null
        ? `${sessionId}:${scheduleId}:${memberId}` : null;
    const [result, setResult] = useState<{ key: string; snapshot: AutomaticJourneySnapshot | null }>();
    const checkpoint = useSyncExternalStore(subscribeAutomaticJourneySync, getValidatedCheckpoint, getValidatedCheckpoint);
    useEffect(() => {
        if (!key) return;
        let mounted = true;
        let revision = 0;
        const remove = subscribeAutomaticJourney(value => {
            if (!mounted) return;
            revision += 1;
            setResult({ key, snapshot: value });
        });
        const refresh = () => {
            const request = ++revision;
            getAutomaticJourneySnapshot().then(value => {
                if (mounted && revision === request) setResult({ key, snapshot: value });
            }).catch(() => {
                if (mounted && revision === request) setResult({ key, snapshot: null });
            });
        };
        refresh();
        const foreground = AppState.addEventListener('change', state => {
            if (state === 'active') refresh();
        });
        return () => {
            mounted = false;
            remove();
            foreground.remove();
        };
    }, [key]);

    if (!key) return 'schedule';
    if (result?.key !== key) return 'pending';
    return resolveGuidanceActivityHandoff(result.snapshot, sessionId, scheduleId, memberId, checkpoint);
}
