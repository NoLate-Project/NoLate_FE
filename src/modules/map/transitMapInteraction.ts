export type TransitMapInteraction =
    | { kind: "leg"; legIndex: number }
    | { kind: "stop"; legIndex: number; stopIndex: number };

export function buildTransitLegInteractionId(legIndex: number): string {
    return `transit-leg:${Math.max(0, Math.trunc(legIndex))}`;
}

export function buildTransitStopInteractionId(legIndex: number, stopIndex: number): string {
    return `transit-stop:${Math.max(0, Math.trunc(legIndex))}:${Math.max(0, Math.trunc(stopIndex))}`;
}

export function parseTransitMapInteractionId(value: string | undefined): TransitMapInteraction | undefined {
    if (!value) return undefined;
    const legMatch = value.match(/^transit-leg:(\d+)$/);
    if (legMatch) {
        return { kind: "leg", legIndex: Number(legMatch[1]) };
    }

    const stopMatch = value.match(/^transit-stop:(\d+):(\d+)$/);
    if (stopMatch) {
        return {
            kind: "stop",
            legIndex: Number(stopMatch[1]),
            stopIndex: Number(stopMatch[2]),
        };
    }
    return undefined;
}
