export type SingleFlightRunner<T> = (operation: () => Promise<T>) => Promise<T>;

/**
 * 동시에 시작된 동일 작업이 하나의 Promise를 공유하게 한다.
 * 인증 토큰처럼 한 번만 갱신해야 하는 작업의 중복 실행과 회전 토큰 충돌을 막는다.
 */
export function createSingleFlightRunner<T>(): SingleFlightRunner<T> {
    let inFlight: Promise<T> | null = null;

    return (operation) => {
        if (!inFlight) {
            inFlight = Promise.resolve()
                .then(operation)
                .finally(() => {
                    inFlight = null;
                });
        }

        return inFlight;
    };
}
