export type LocalNotificationModules = Pick<
    typeof import('expo-notifications/build/NotificationsEmitter'),
    'addNotificationReceivedListener' | 'addNotificationResponseReceivedListener'
    | 'getLastNotificationResponse' | 'clearLastNotificationResponse'
> & Pick<typeof import('expo-notifications/build/NotificationsHandler'), 'setNotificationHandler'>;

/** Lazy, bundled local-only modules. No permission request, token manager or root package.
 * Literal require avoids Metro async chunks resolving relative to a shared node_modules checkout.
 */
export function loadLocalNotificationModules(): LocalNotificationModules {
    const emitter = require('expo-notifications/build/NotificationsEmitter') as
        typeof import('expo-notifications/build/NotificationsEmitter');
    const handler = require('expo-notifications/build/NotificationsHandler') as
        typeof import('expo-notifications/build/NotificationsHandler');
    if (typeof emitter.addNotificationReceivedListener !== 'function'
        || typeof emitter.addNotificationResponseReceivedListener !== 'function'
        || typeof emitter.getLastNotificationResponse !== 'function'
        || typeof emitter.clearLastNotificationResponse !== 'function'
        || typeof handler.setNotificationHandler !== 'function') {
        throw new Error('LOCAL_NOTIFICATION_MODULE_UNAVAILABLE');
    }
    return {
        addNotificationReceivedListener: emitter.addNotificationReceivedListener,
        addNotificationResponseReceivedListener: emitter.addNotificationResponseReceivedListener,
        getLastNotificationResponse: emitter.getLastNotificationResponse,
        clearLastNotificationResponse: emitter.clearLastNotificationResponse,
        setNotificationHandler: handler.setNotificationHandler,
    };
}
