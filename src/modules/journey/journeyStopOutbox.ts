import { normalizeAutomaticJourneyBinding, type AutomaticJourneyBinding } from './automaticJourney';

export const JOURNEY_STOP_OUTBOX_KEY = '@nolate/automatic-journey-stop-outbox-v1';
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
export type JourneyStopSummary = { pendingCount: number; errorCode: string | null };
const bindingKey = (binding: AutomaticJourneyBinding) => `${binding.sessionId}:${binding.generation}:${binding.routeRevision}:${binding.clientOwnerId}`;
const safeError = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.message)
    ? error.message : 'STOP_DELIVERY_UNAVAILABLE';

/** Token/coordinate-free stop intent. A successful, identity-fenced server receipt alone removes it. */
export function createJourneyStopOutbox(storage: Storage) {
    let chain: Promise<unknown> = Promise.resolve();
    let summary: JourneyStopSummary = { pendingCount: 0, errorCode: null };
    const serial = <T,>(operation: () => Promise<T>): Promise<T> => {
        const next = chain.then(operation, operation);
        chain = next.catch(() => undefined);
        return next;
    };
    const read = async (): Promise<AutomaticJourneyBinding[]> => {
        const raw = await storage.getItem(JOURNEY_STOP_OUTBOX_KEY);
        if (!raw) return [];
        try {
            if (raw.length > 32768) throw new Error();
            const value = JSON.parse(raw);
            if (value?.schemaVersion !== 1 || !Array.isArray(value.bindings) || value.bindings.length > 8) throw new Error();
            const bindings = value.bindings.map(normalizeAutomaticJourneyBinding);
            if (bindings.some((binding: AutomaticJourneyBinding | null) => !binding || binding.syncScope === 'LOCAL_ONLY')
                || new Set(bindings.map(bindingKey)).size !== bindings.length) throw new Error();
            return bindings;
        } catch { throw new Error('STOP_OUTBOX_INVALID'); }
    };
    const write = (bindings: AutomaticJourneyBinding[]) => storage.setItem(JOURNEY_STOP_OUTBOX_KEY, JSON.stringify({ schemaVersion: 1, bindings }));
    return {
        summary: () => ({ ...summary }),
        enqueue: (candidate: AutomaticJourneyBinding) => serial(async () => {
            try {
                const binding = normalizeAutomaticJourneyBinding(candidate);
                if (!binding || binding.syncScope === 'LOCAL_ONLY') throw new Error('STOP_BINDING_INVALID');
                const bindings = await read();
                const previous = bindings.find(item => bindingKey(item) === bindingKey(binding));
                if (previous && JSON.stringify(previous) !== JSON.stringify(binding)) throw new Error('STOP_BINDING_CONFLICT');
                if (!previous) {
                    if (bindings.length >= 8) throw new Error('STOP_OUTBOX_FULL');
                    bindings.push(binding);
                    await write(bindings);
                }
                summary = { pendingCount: bindings.length, errorCode: null };
            } catch (error) {
                summary = { ...summary, errorCode: safeError(error) };
                throw new Error(summary.errorCode ?? 'STOP_OUTBOX_STORAGE_UNAVAILABLE');
            }
        }),
        drain: (send: (binding: AutomaticJourneyBinding) => Promise<void>) => serial(async () => {
            let bindings: AutomaticJourneyBinding[];
            try { bindings = await read(); }
            catch (error) { summary = { ...summary, errorCode: safeError(error) }; return { ...summary }; }
            summary = { pendingCount: bindings.length, errorCode: null };
            for (const binding of [...bindings]) {
                try {
                    await send(binding);
                    const retained = bindings.filter(item => bindingKey(item) !== bindingKey(binding));
                    // If storage fails, retain the intent for an idempotent resend after restart.
                    await write(retained);
                    bindings = retained;
                } catch (error) { summary.errorCode = safeError(error); }
            }
            summary.pendingCount = bindings.length;
            return { ...summary };
        }),
    };
}
