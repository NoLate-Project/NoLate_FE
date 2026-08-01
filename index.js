import "@expo/metro-runtime";

import { getMessaging, setBackgroundMessageHandler } from "@react-native-firebase/messaging";
import { ExpoRoot } from "expo-router/build/ExpoRoot";
import { ctx } from "expo-router/_ctx";
import { renderRootComponent } from "expo-router/build/renderRootComponent";

import { AppProviders } from "./src/AppProviders";
import { handleBackgroundPushMessage } from "./src/modules/notification/backgroundPush";

/**
 * React tree가 생성되기 전에 background handler를 등록한다.
 * 표시용 payload는 OS가 처리하고, 화면 이동은 사용자가 알림을 누른 뒤 앱 내부에서 처리한다.
 */
setBackgroundMessageHandler(getMessaging(), async (message) => {
    // 예약 동기화는 표시 없는 data payload로만 처리한다. 표준 표시용 payload는
    // 기존처럼 OS가 처리하며 이 handler에서 별도 로컬 알림을 만들지 않는다.
    await handleBackgroundPushMessage(message);
});

function App() {
    return <ExpoRoot context={ctx} wrapper={AppProviders} />;
}

renderRootComponent(App);
