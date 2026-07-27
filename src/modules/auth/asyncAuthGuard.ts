export function createAsyncAuthGuard(getEpoch: () => number) {
    let generation = 0;
    let disposed = false;

    return {
        capture(): { epoch: number; generation: number } {
            return { epoch: getEpoch(), generation };
        },
        isCurrent(token: { epoch: number; generation: number }): boolean {
            return !disposed &&
                token.epoch === getEpoch() &&
                token.generation === generation;
        },
        invalidate(): void {
            generation += 1;
        },
        dispose(): void {
            disposed = true;
            generation += 1;
        },
    };
}
