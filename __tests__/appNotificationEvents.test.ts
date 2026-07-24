import {
    emitAppNotificationReceived,
    subscribeAppNotificationReceived,
} from "../src/modules/notification/appNotificationEvents";

describe("app notification events", () => {
    test("하나의 push 수신 이벤트를 모든 배지 갱신 구독자에게 전달한다", () => {
        const refreshShareAttention = jest.fn();
        const refreshNotificationUnreadCount = jest.fn();
        const unsubscribeShareAttention = subscribeAppNotificationReceived(
            refreshShareAttention,
        );
        const unsubscribeNotificationUnreadCount = subscribeAppNotificationReceived(
            refreshNotificationUnreadCount,
        );

        emitAppNotificationReceived();

        expect(refreshShareAttention).toHaveBeenCalledTimes(1);
        expect(refreshNotificationUnreadCount).toHaveBeenCalledTimes(1);

        unsubscribeShareAttention();
        unsubscribeNotificationUnreadCount();
        emitAppNotificationReceived();

        expect(refreshShareAttention).toHaveBeenCalledTimes(1);
        expect(refreshNotificationUnreadCount).toHaveBeenCalledTimes(1);
    });
});
