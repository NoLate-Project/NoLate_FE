export type ApiEnvelope<T> = {
    success: boolean;
    data?: T | null;
    errorMessage?: string | null;
};

export function unwrapApiResponse<T>(response: ApiEnvelope<T>): T {
    if (response.success && response.data !== undefined && response.data !== null) {
        return response.data;
    }

    throw new Error(response.errorMessage ?? "요청 처리에 실패했습니다.");
}

export function assertApiSuccess(response: ApiEnvelope<unknown>): void {
    if (response.success) return;
    throw new Error(response.errorMessage ?? "요청 처리에 실패했습니다.");
}
