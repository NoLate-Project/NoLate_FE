export type LatestAsyncRequestTicket<Key> = Readonly<{
    key: Key;
    sequence: number;
}>;

/**
 * 화면의 조회 대상이 바뀌거나 새로고침이 겹칠 때 늦게 끝난 이전 응답이
 * 현재 화면 상태를 덮지 못하게 하는 작은 요청 세대 관리자입니다.
 */
export function createLatestAsyncRequestGuard<Key>(initialKey: Key) {
    let currentKey = initialKey;
    let sequence = 0;

    return {
        setKey(nextKey: Key): void {
            currentKey = nextKey;
            sequence += 1;
        },
        begin(key: Key = currentKey): LatestAsyncRequestTicket<Key> {
            currentKey = key;
            sequence += 1;
            return { key, sequence };
        },
        isCurrent(ticket: LatestAsyncRequestTicket<Key>): boolean {
            return ticket.sequence === sequence && Object.is(ticket.key, currentKey);
        },
        invalidate(): void {
            sequence += 1;
        },
    };
}
