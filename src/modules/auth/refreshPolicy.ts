export function isDefinitiveRefreshStatus(status?: number): boolean {
    // The refresh endpoint returns 404 when the token's member was withdrawn or
    // otherwise removed. That session can never recover and must not remain in
    // the local authenticated state.
    return status === 400 || status === 401 || status === 403 || status === 404;
}

/** Matches API errors after the Axios interceptor has preserved their status. */
export function isDefinitiveAuthRejection(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" && isDefinitiveRefreshStatus(status);
}
