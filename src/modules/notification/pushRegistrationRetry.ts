type PushRegistrationRetryOptions = {
    delaysMs: readonly number[];
    isCurrent: () => boolean;
    sleep?: (delayMs: number) => Promise<void>;
};

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
});

/**
 * APNs 토큰 발급과 FCM 토큰 교환은 앱 시작 직후 네이티브 등록보다 늦게 끝날 수 있다.
 * 한 번의 부트스트랩 실패로 계정이 계속 NO_TOKEN 상태에 머물지 않도록 제한된 횟수만
 * 재시도한다. 로그아웃으로 인증 세대가 바뀌면 이전 계정 토큰을 등록하지 않도록 즉시 멈춘다.
 */
export async function retryPushRegistration(
    task: () => Promise<void>,
    {
        delaysMs,
        isCurrent,
        sleep = defaultSleep,
    }: PushRegistrationRetryOptions,
): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
        if (!isCurrent()) return;

        const delayMs = delaysMs[attempt];
        if (delayMs > 0) {
            await sleep(delayMs);
            if (!isCurrent()) return;
        }

        try {
            await task();
            return;
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError !== undefined) throw lastError;
}
