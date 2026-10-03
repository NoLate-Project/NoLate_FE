export type ApiEnvelope<T> = {
    success: boolean;
    data?: T | null;
    errorMessage?: string | null;
    errorCode?: string | null;
};

/**
 * Keeps the server's stable error contract available after the Axios layer.
 * Screens may still use `message`, while flows that need an exact decision can
 * branch on `errorCode` or `status` without parsing localized copy.
 */
export class ApiResponseError extends Error {
    readonly errorCode?: string;
    readonly status?: number;
    readonly cause?: unknown;

    constructor(
        message: string,
        options: { errorCode?: string | null; status?: number; cause?: unknown } = {},
    ) {
        super(message);
        this.name = "ApiResponseError";
        this.errorCode = options.errorCode ?? undefined;
        this.status = options.status;
        this.cause = options.cause;
    }
}

/** Refresh conclusively rejected the session (not a timeout or server outage). */
export class AuthSessionInvalidatedError extends ApiResponseError {
    constructor(cause?: unknown) {
        super("로그인 세션이 만료되었어요.", {
            errorCode: "AUTH_SESSION_INVALIDATED",
            status: 401,
            cause,
        });
    }
}

export function unwrapApiResponse<T>(response: ApiEnvelope<T>): T {
    if (response.success && response.data !== undefined && response.data !== null) {
        return response.data;
    }

    throw new ApiResponseError(response.errorMessage ?? "요청 처리에 실패했습니다.", {
        errorCode: response.errorCode,
    });
}

export function assertApiSuccess(response: ApiEnvelope<unknown>): void {
    if (response.success) return;
    throw new ApiResponseError(response.errorMessage ?? "요청 처리에 실패했습니다.", {
        errorCode: response.errorCode,
    });
}
