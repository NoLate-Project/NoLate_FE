export class CalendarImportTimeoutError extends Error {
    readonly operation: string;

    constructor(operation: string) {
        super(`${operation} 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.`);
        this.name = "CalendarImportTimeoutError";
        this.operation = operation;
    }
}

/**
 * 네이티브 권한, EventKit, 외부 API가 응답하지 않더라도 큐레이션 화면이 영구 대기하지
 * 않게 한다. onTimeout에는 fetch abort처럼 실제 작업을 중단할 수 있는 정리 함수를 넘긴다.
 */
export async function withCalendarImportTimeout<T>(
    operation: PromiseLike<T>,
    options: {
        timeoutMs: number;
        operationName: string;
        onTimeout?: () => void;
    }
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            try {
                options.onTimeout?.();
            } finally {
                reject(new CalendarImportTimeoutError(options.operationName));
            }
        }, options.timeoutMs);
    });

    try {
        return await Promise.race([Promise.resolve(operation), timeout]);
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
}
