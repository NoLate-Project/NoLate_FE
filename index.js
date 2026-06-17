import "@expo/metro-runtime";

import { getMessaging, setBackgroundMessageHandler } from "@react-native-firebase/messaging";
import { ExpoRoot } from "expo-router/build/ExpoRoot";
import { ctx } from "expo-router/_ctx";
import { renderRootComponent } from "expo-router/build/renderRootComponent";

import { AppProviders } from "./src/AppProviders";

/**
 * React tree가 생성되기 전에 background handler를 등록한다.
 * 표시용 payload는 OS가 처리하고, 화면 이동은 사용자가 알림을 누른 뒤 앱 내부에서 처리한다.
 */
setBackgroundMessageHandler(getMessaging(), async () => {
    // 백그라운드 data payload를 수신했다는 사실만 Firebase에 알리면 된다.
});

function App() {
    return <ExpoRoot context={ctx} wrapper={AppProviders} />;
}

renderRootComponent(App);
