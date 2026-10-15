/** Shared ride semantics. Realtime arrival support is a separate capability. */
export const TRANSIT_RIDE_KINDS = ["SUBWAY", "BUS", "TRAIN", "EXPRESS_BUS", "INTERCITY_BUS", "COACH"] as const;
export type TransitRideKind = typeof TRANSIT_RIDE_KINDS[number];

export function isTransitRideKind(kind: unknown): kind is TransitRideKind {
    return typeof kind === "string" && TRANSIT_RIDE_KINDS.some(value => value === kind);
}

export function isIntercityRideKind(kind: unknown): boolean {
    return kind === "TRAIN" || kind === "EXPRESS_BUS" || kind === "INTERCITY_BUS" || kind === "COACH";
}

export const TRANSIT_MODE_LABELS = {
    SUBWAY: "지하철", BUS: "버스", TRAIN: "기차", EXPRESS_BUS: "고속버스",
    INTERCITY_BUS: "시외버스", COACH: "고속·시외버스", WALK: "도보", TRANSFER: "환승", ETC: "이동 수단 확인", UNKNOWN: "이동 수단 확인",
} as const;

export function transitModeLabel(kind: string): string {
    return TRANSIT_MODE_LABELS[kind as keyof typeof TRANSIT_MODE_LABELS] ?? "이동 수단 확인";
}

export function intercityRideColor(kind: string): string | undefined {
    if (kind === "TRAIN") return "#2563EB";
    if (kind === "EXPRESS_BUS" || kind === "COACH") return "#7C3AED";
    if (kind === "INTERCITY_BUS") return "#0F766E";
    return undefined;
}
