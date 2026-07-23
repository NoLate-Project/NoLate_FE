import { shouldRegisterRemotePush } from "../src/modules/notification/pushRegistrationDevicePolicy";

describe("push registration device policy", () => {
    test("iOS 실기기에서는 원격 푸시 토큰 등록을 수행한다", () => {
        expect(shouldRegisterRemotePush("ios", true)).toBe(true);
    });

    test("APNs 토큰을 발급할 수 없는 iOS 시뮬레이터만 등록에서 제외한다", () => {
        expect(shouldRegisterRemotePush("ios", false)).toBe(false);
    });

    test("Android는 에뮬레이터에서도 FCM 검증이 가능하므로 등록을 수행한다", () => {
        expect(shouldRegisterRemotePush("android", false)).toBe(true);
    });
});
