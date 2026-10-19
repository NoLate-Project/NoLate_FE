/** Small bounded JSON client shared by diagnostic and authenticated journey transports.
 * Never follows redirects, shares cookies, caches credentials, or reports response bodies. */
export async function journeyJSONRequest(url: string, body?: Record<string, unknown>): Promise<unknown> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 4000);
    try {
        const request: RequestInit & { redirect: "error" } = {
            method: body ? "POST" : "GET", credentials: "omit", redirect: "error", signal: abort.signal,
            headers: { "Content-Type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}),
        };
        const response = await fetch(url, request);
        if (response.redirected || response.url && response.url !== url) throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE");
        if (!response.ok) throw new Error([400, 401, 403, 404, 409, 410, 422].includes(response.status)
            ? "AUTOMATIC_SERVER_REJECTED" : "AUTOMATIC_SERVER_UNAVAILABLE");
        const text = await response.text();
        if (text.length > 65536) throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE");
        try { return JSON.parse(text) as unknown; } catch { throw new Error("INVALID_AUTOMATIC_SERVER_RESPONSE"); }
    } finally { clearTimeout(timer); }
}
