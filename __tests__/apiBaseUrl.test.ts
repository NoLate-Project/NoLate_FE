import { resolveApiBaseUrl } from "../src/api/apiBaseUrl";

describe("resolveApiBaseUrl", () => {
    test("iOS 개발 빌드는 운영 URL이 설정되어 있어도 로컬 BE를 사용한다", () => {
        expect(resolveApiBaseUrl({
            configuredUrl: "https://nolate.jinuk.dev",
            isDevelopment: true,
            platform: "ios",
        })).toBe("http://127.0.0.1:5522");
    });

    test("Android Emulator 개발 빌드는 호스트 전용 주소를 사용한다", () => {
        expect(resolveApiBaseUrl({
            isDevelopment: true,
            platform: "android",
        })).toBe("http://10.0.2.2:5522");
    });

    test("실기기 테스트용 명시 주소는 개발 기본값보다 우선한다", () => {
        expect(resolveApiBaseUrl({
            explicitLocalUrl: "http://192.168.0.22:5522",
            configuredUrl: "https://nolate.jinuk.dev",
            isDevelopment: true,
            platform: "ios",
        })).toBe("http://192.168.0.22:5522");
    });

    test("배포 빌드는 설정된 운영 URL을 사용한다", () => {
        expect(resolveApiBaseUrl({
            configuredUrl: "https://api.example.com",
            isDevelopment: false,
            platform: "ios",
        })).toBe("https://api.example.com");
    });
});
