type AppNotificationListener = () => void;

const listeners = new Set<AppNotificationListener>();

/** 포그라운드 push 도착 직후 화면 배지가 공유함과 영속 알림 상태를 다시 읽게 한다. */
export function emitAppNotificationReceived(): void {
    listeners.forEach((listener) => listener());
}

export function subscribeAppNotificationReceived(listener: AppNotificationListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
