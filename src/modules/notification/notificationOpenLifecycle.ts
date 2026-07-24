export type NotificationOpenSource<TExpoResponse, TFirebaseMessage> = {
    addExpoResponseListener?: (
        listener: (response: TExpoResponse) => void,
    ) => { remove: () => void };
    onFirebaseOpened: (
        listener: (message: TFirebaseMessage) => void,
    ) => () => void;
    getInitialFirebase: () => Promise<TFirebaseMessage | null>;
    getLastExpoResponse?: () => TExpoResponse | null;
    clearLastExpoResponse?: () => void;
};

/**
 * background listener를 먼저 연결한 뒤 terminated 초기 이벤트를 모두 소비한다.
 * Firebase 초기 이벤트가 있더라도 Expo 마지막 응답을 반드시 지워 다음 active 전환에서
 * 재전달되지 않게 하고, 동일 이벤트 여부는 상위 canonical consumer가 판단한다.
 */
export async function configureNotificationOpenLifecycle<TExpoResponse, TFirebaseMessage>(
    source: NotificationOpenSource<TExpoResponse, TFirebaseMessage>,
    handlers: {
        handleExpoResponse: (response: TExpoResponse) => void;
        handleFirebaseMessage: (message: TFirebaseMessage) => void;
        getExpoEventKey?: (response: TExpoResponse) => string | undefined;
        getFirebaseEventKey?: (message: TFirebaseMessage) => string | undefined;
        isExpoAction?: (response: TExpoResponse) => boolean;
    },
): Promise<() => void> {
    const expoSubscription = source.addExpoResponseListener?.(
        handlers.handleExpoResponse,
    );
    const unsubscribeFirebase = source.onFirebaseOpened(
        handlers.handleFirebaseMessage,
    );
    const initialFirebase = await source.getInitialFirebase();
    const initialExpo = source.getLastExpoResponse?.() ?? null;

    if (initialExpo) {
        source.clearLastExpoResponse?.();
    }

    if (initialFirebase && initialExpo) {
        const expoKey = handlers.getExpoEventKey?.(initialExpo);
        const firebaseKey = handlers.getFirebaseEventKey?.(initialFirebase);
        const sameEvent = Boolean(expoKey && firebaseKey && expoKey === firebaseKey);
        if (sameEvent && handlers.isExpoAction?.(initialExpo)) {
            // Explicit actions mutate first. Firebase may still provide the launch
            // navigation intent; its consumer will navigate at most once.
            handlers.handleExpoResponse(initialExpo);
        }
        handlers.handleFirebaseMessage(initialFirebase);
    } else if (initialFirebase) {
        handlers.handleFirebaseMessage(initialFirebase);
    } else if (initialExpo) {
        handlers.handleExpoResponse(initialExpo);
    }

    return () => {
        expoSubscription?.remove();
        unsubscribeFirebase();
    };
}
