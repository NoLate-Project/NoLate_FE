type ScheduleMutationListener = () => void;

const listeners = new Set<ScheduleMutationListener>();

/** 로컬 mutation 또는 원격 가시성 변경 직후 조회 결과 캐시를 무효화한다. */
export function emitScheduleMutation(): void {
    listeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // A cache listener must never turn a successful server mutation
            // into a client-visible mutation failure.
        }
    });
}

export function subscribeScheduleMutation(
    listener: ScheduleMutationListener,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
