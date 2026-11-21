/** Memory-only proof that this account/install token was accepted by our API.
 * Never persist it with journey bindings or expose it in diagnostics. */
type AcceptedPushRoute = {
    memberId: number; apiOrigin: string; credentialRevision: number; registrationGeneration: number; token: string;
};
let accepted: AcceptedPushRoute | null = null;
const listeners = new Set<() => void>();
function notify(): void { listeners.forEach(listener => { try { listener(); } catch { /* Registration already succeeded. */ } }); }
export function acceptPushRoute(value: AcceptedPushRoute): void {
    accepted = value.token.length > 0 && value.token.length <= 4096 && !/[\s\u0000-\u001f\u007f]/u.test(value.token)
        ? { ...value } : null;
    notify();
}
export function clearAcceptedPushRoute(): void { accepted = null; notify(); }
export function subscribeAcceptedPushRoute(listener: () => void): () => void {
    listeners.add(listener); return () => { listeners.delete(listener); };
}
export function acceptedPushRouteToken(identity: Omit<AcceptedPushRoute, 'token'>): string | null {
    return accepted && accepted.memberId === identity.memberId && accepted.apiOrigin === identity.apiOrigin
        && accepted.credentialRevision === identity.credentialRevision
        && accepted.registrationGeneration === identity.registrationGeneration ? accepted.token : null;
}
