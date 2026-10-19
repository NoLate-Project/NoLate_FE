import type { JourneySession, JourneyProgressRequest, JourneyTerminalRequest } from "../../api/journey";
import { journeyProgressRequest } from "../../api/journey";
import { normalizeJourneyRoute } from "./journeyRoute";
import { transitionJourney } from "./journeyStateMachine";
import type { JourneyProgress } from "./types";

export type JourneySessionViewState = {
    session: JourneySession | null;
    ready: boolean;
    pending: boolean;
    error: string | null;
};

export type JourneySessionDependencies = {
    load: () => Promise<JourneySession | null>;
    start: (requestId: string, deviceId?: string) => Promise<JourneySession>;
    update: (id: string, request: JourneyProgressRequest) => Promise<JourneySession>;
    finish: (id: string, operation: "arrive" | "stop", request: JourneyTerminalRequest) => Promise<JourneySession>;
    deviceId: () => Promise<string | undefined>;
    makeRequestId: () => string;
    now: () => number;
    onStarted: (session: JourneySession) => void;
    onFinished: (session: JourneySession) => void;
};

/** One mounted, authenticated screen owns this controller; dispose invalidates every late reply. */
export function createJourneySessionController(
    dependencies: JourneySessionDependencies,
    onChange: (state: JourneySessionViewState) => void,
) {
    let state: JourneySessionViewState = { session: null, ready: false, pending: false, error: null };
    let disposed = false;
    let readGeneration = 0;
    let startRequestId: string | undefined;

    function publish(change: Partial<JourneySessionViewState>) {
        if (disposed) return;
        state = { ...state, ...change };
        onChange(state);
    }

    function accept(session: JourneySession | null) {
        const previous = state.session;
        if (previous && session && previous.sessionId === session.sessionId && session.sequence < previous.sequence) return;
        if (previous && session && previous.generation > session.generation) return;
        if (previous && session && previous.sessionId === session.sessionId
            && (previous.phase === "ARRIVED" || previous.phase === "STOPPED")
            && session.phase !== previous.phase) return;
        publish({ session, ready: true, error: null });
    }

    function recoverLocally(session: JourneySession, operation: "start" | "advance" | "stop") {
        try {
            if (operation === "start") dependencies.onStarted(session);
            if (session.phase === "ARRIVED" || session.phase === "STOPPED") dependencies.onFinished(session);
        } catch { /* Local recovery must not undo an acknowledged server mutation. */ }
    }

    function errorMessage(error: unknown): string {
        const code = (error as { errorCode?: string })?.errorCode;
        if (code === "C006") return "아직 이 서버에서는 길안내를 사용할 수 없어요.";
        return error instanceof Error ? error.message : "연결 상태를 확인하고 다시 시도해 주세요.";
    }

    async function refresh() {
        if (disposed || state.pending) return;
        const generation = ++readGeneration;
        try {
            const session = await dependencies.load();
            if (!disposed && generation === readGeneration) accept(session);
        } catch (error) {
            if (!disposed && generation === readGeneration) publish({ error: errorMessage(error) });
        }
    }

    async function run(operation: "start" | "advance" | "stop") {
        if (disposed || state.pending || !state.ready) return;
        const current = state.session;
        if (operation !== "start" && !current) return;
        if (current && (current.phase === "ARRIVED" || current.phase === "STOPPED")) return;
        if (operation === "start" && current) return;
        ++readGeneration;
        publish({ pending: true, error: null });
        let intended: JourneyProgress | undefined;
        try {
            let next: JourneySession;
            if (operation === "start") {
                startRequestId ??= dependencies.makeRequestId();
                const deviceId = await dependencies.deviceId();
                if (disposed) return;
                next = await dependencies.start(startRequestId, deviceId);
            } else {
                const session = current!;
                if (operation === "advance" && Date.parse(session.expiresAt) <= dependencies.now()) {
                    throw new Error("안내 시간이 만료되었어요. 새로고침해 주세요.");
                }
                const route = normalizeJourneyRoute(session.routeLegs);
                const progress = transitionJourney(session, route, {
                    type: operation === "stop" ? "STOP" : "ADVANCE",
                    sessionId: session.sessionId,
                    generation: session.generation,
                    routeRevision: session.routeRevision,
                    sequence: session.sequence + 1,
                    observedAt: new Date(Math.max(dependencies.now(), Date.parse(session.observedAt) + 1)).toISOString(),
                    source: "MANUAL",
                });
                if (progress === session) return;
                intended = progress;
                if (progress.phase === "ARRIVED" || progress.phase === "STOPPED") {
                    next = await dependencies.finish(session.sessionId,
                        progress.phase === "ARRIVED" ? "arrive" : "stop", {
                            generation: progress.generation,
                            routeRevision: progress.routeRevision,
                            sequence: progress.sequence,
                            observedAt: progress.observedAt,
                        });
                } else {
                    next = await dependencies.update(session.sessionId, journeyProgressRequest(progress));
                }
            }
            if (disposed) return;
            accept(next);
            // Local alarm/cache recovery cannot turn a committed journey into an API failure.
            recoverLocally(next, operation);
        } catch (error) {
            if (disposed) return;
            // A timeout may happen after commit. Read back before enabling another step.
            try {
                const reconciled = await dependencies.load();
                if (disposed) return;
                accept(reconciled);
                const confirmed = reconciled && (operation === "start"
                    ? reconciled.sessionId === startRequestId || (reconciled.phase !== "ARRIVED" && reconciled.phase !== "STOPPED")
                    : intended && reconciled.sessionId === intended.sessionId
                        && reconciled.generation === intended.generation
                        && reconciled.routeRevision === intended.routeRevision
                        && (reconciled.sequence > intended.sequence
                            || (reconciled.sequence === intended.sequence && reconciled.phase === intended.phase)));
                if (confirmed && reconciled) {
                    recoverLocally(reconciled, operation);
                    return;
                }
            } catch {
                // An ambiguous commit must be read back before another mutation is allowed.
                publish({ ready: false });
            }
            publish({ error: errorMessage(error) });
        } finally {
            publish({ pending: false });
        }
    }

    return {
        refresh,
        start: () => run("start"),
        advance: () => run("advance"),
        stop: () => run("stop"),
        dispose: () => { disposed = true; ++readGeneration; },
        getState: () => state,
    };
}
