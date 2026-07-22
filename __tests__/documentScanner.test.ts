describe("document scanner bridge", () => {
    async function loadModuleWithNative(nativeModule?: {
        isSupported: jest.Mock;
        scan: jest.Mock;
        discard?: jest.Mock;
    }) {
        jest.resetModules();
        jest.doMock("react-native", () => ({
            NativeModules: nativeModule ? { NoLateDocumentScanner: nativeModule } : {},
            Platform: { OS: "ios" },
        }));
        return require("../src/modules/schedule/documentScanner") as typeof import("../src/modules/schedule/documentScanner");
    }

    afterEach(() => {
        jest.dontMock("react-native");
    });

    test("지원 여부를 네이티브 모듈에서 확인한다", async () => {
        const nativeModule = {
            isSupported: jest.fn().mockResolvedValue(true),
            scan: jest.fn(),
        };
        const { canScanDocuments } = await loadModuleWithNative(nativeModule);

        await expect(canScanDocuments()).resolves.toBe(true);
        expect(nativeModule.isSupported).toHaveBeenCalledTimes(1);
    });

    test("네이티브에서 지원하지 않는 환경은 스캐너를 노출하지 않는다", async () => {
        const nativeModule = {
            isSupported: jest.fn().mockResolvedValue(false),
            scan: jest.fn(),
        };
        const { canScanDocuments } = await loadModuleWithNative(nativeModule);

        await expect(canScanDocuments()).resolves.toBe(false);
        expect(nativeModule.scan).not.toHaveBeenCalled();
    });

    test("지원 여부 확인이 실패하면 안전하게 지원하지 않음으로 처리한다", async () => {
        const nativeModule = {
            isSupported: jest.fn().mockRejectedValue(new Error("native unavailable")),
            scan: jest.fn(),
        };
        const { canScanDocuments } = await loadModuleWithNative(nativeModule);

        await expect(canScanDocuments()).resolves.toBe(false);
    });

    test("스캔 옵션을 안전한 범위로 제한하고 보정 이미지 목록을 반환한다", async () => {
        const nativeModule = {
            isSupported: jest.fn().mockResolvedValue(true),
            scan: jest.fn().mockResolvedValue({
                capturedPageCount: 3,
                pages: [{
                    uri: " file:///tmp/scan-1.jpg ",
                    width: 1200.4,
                    height: 1600.6,
                }],
            }),
        };
        const { scanDocuments } = await loadModuleWithNative(nativeModule);

        await expect(scanDocuments({ maxPages: 99, jpegQuality: 0.2 })).resolves.toEqual({
            capturedPageCount: 3,
            pages: [{
                uri: "file:///tmp/scan-1.jpg",
                width: 1200,
                height: 1601,
            }],
        });
        expect(nativeModule.scan).toHaveBeenCalledWith({ maxPages: 10, jpegQuality: 0.7 });
    });

    test("스캔 임시파일 정리를 네이티브 모듈에 위임한다", async () => {
        const nativeModule = {
            isSupported: jest.fn(),
            scan: jest.fn(),
            discard: jest.fn().mockResolvedValue(undefined),
        };
        const { discardDocumentScanPages } = await loadModuleWithNative(nativeModule);

        await discardDocumentScanPages([
            " file:///tmp/scan-1.jpg ",
            "file:///tmp/scan-1.jpg",
            "",
        ]);

        expect(nativeModule.discard).toHaveBeenCalledWith(["file:///tmp/scan-1.jpg"]);
    });

    test("사용자 취소는 오류가 아닌 null로 반환한다", async () => {
        const nativeModule = {
            isSupported: jest.fn(),
            scan: jest.fn().mockResolvedValue({ cancelled: true }),
        };
        const { scanDocuments } = await loadModuleWithNative(nativeModule);

        await expect(scanDocuments()).resolves.toBeNull();
    });

    test("네이티브 화면 표시 실패는 호출자에게 즉시 전달한다", async () => {
        const presentationError = new Error("presentation timeout");
        const nativeModule = {
            isSupported: jest.fn(),
            scan: jest.fn().mockRejectedValue(presentationError),
        };
        const { scanDocuments } = await loadModuleWithNative(nativeModule);

        await expect(scanDocuments()).rejects.toBe(presentationError);
    });

    test("네이티브 모듈이 없으면 지원하지 않으며 스캔 요청은 설명 가능한 오류를 낸다", async () => {
        const { canScanDocuments, scanDocuments } = await loadModuleWithNative();

        await expect(canScanDocuments()).resolves.toBe(false);
        await expect(scanDocuments()).rejects.toThrow("이 기기에서는 문서 스캔을 사용할 수 없습니다.");
    });
});
