export function getMinimumTouchTarget(platform: string): number {
    return platform === "android" ? 48 : 44;
}
