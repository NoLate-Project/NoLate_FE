import { shouldRegisterRemotePush, supportsIosSimulatorPush } from "../src/modules/notification/pushRegistrationDevicePolicy";

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
    test('supported ARM64 Simulator receives real sandbox APNs registration', () => {
        expect(supportsIosSimulatorPush('27.0', ['arm64'])).toBe(true);
        // NXGetLocalArchInfo used by expo-device reports arm64e on Apple Silicon.
        expect(supportsIosSimulatorPush('27.0', ['arm64e'])).toBe(true);
        expect(supportsIosSimulatorPush('27.0', ['arm64invalid'])).toBe(false);
        expect(supportsIosSimulatorPush('16.6', ['arm64 v8'])).toBe(true);
        expect(shouldRegisterRemotePush('ios', false, true)).toBe(true);
        expect(supportsIosSimulatorPush(15, ['arm64'])).toBe(false);
        expect(supportsIosSimulatorPush('27.0', ['x86_64'])).toBe(false);
        expect(supportsIosSimulatorPush('27.0', null)).toBe(false);
    });
});
