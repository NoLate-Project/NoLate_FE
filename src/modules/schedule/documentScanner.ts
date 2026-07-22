import { NativeModules, Platform } from "react-native";

export type DocumentScanPage = {
    uri: string;
    width: number;
    height: number;
};

export type DocumentScanResult = {
    pages: DocumentScanPage[];
    capturedPageCount: number;
};

export type DocumentScanOptions = {
    maxPages?: number;
    jpegQuality?: number;
};

type NativeDocumentScanPage = {
    uri?: unknown;
    width?: unknown;
    height?: unknown;
};

type NativeDocumentScanResult = {
    cancelled?: boolean;
    pages?: NativeDocumentScanPage[];
    capturedPageCount?: unknown;
};

type NativeDocumentScanner = {
    isSupported: () => Promise<boolean>;
    scan: (options: { maxPages: number; jpegQuality: number }) => Promise<NativeDocumentScanResult>;
    discard?: (uris: string[]) => Promise<void>;
};

const nativeDocumentScanner = Platform.OS === "ios"
    ? NativeModules.NoLateDocumentScanner as NativeDocumentScanner | undefined
    : undefined;

export const isDocumentScannerAvailable = Boolean(nativeDocumentScanner);

function normalizedInteger(value: number | undefined, fallback: number, min: number, max: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizedQuality(value: number | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0.94;
    return Math.max(0.7, Math.min(1, value));
}

function normalizePage(value: NativeDocumentScanPage) {
    if (!value || typeof value !== "object") return null;
    const uri = typeof value.uri === "string" ? value.uri.trim() : "";
    if (!uri || typeof value.width !== "number" || typeof value.height !== "number") return null;
    if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) return null;

    return {
        uri,
        width: Math.max(1, Math.round(value.width)),
        height: Math.max(1, Math.round(value.height)),
    } satisfies DocumentScanPage;
}

export async function canScanDocuments(): Promise<boolean> {
    if (!nativeDocumentScanner) return false;
    try {
        return await nativeDocumentScanner.isSupported();
    } catch {
        return false;
    }
}

export async function scanDocuments(
    options: DocumentScanOptions = {}
): Promise<DocumentScanResult | null> {
    if (!nativeDocumentScanner) {
        throw new Error("이 기기에서는 문서 스캔을 사용할 수 없습니다.");
    }

    const result = await nativeDocumentScanner.scan({
        maxPages: normalizedInteger(options.maxPages, 3, 1, 10),
        jpegQuality: normalizedQuality(options.jpegQuality),
    });
    if (result?.cancelled) return null;

    const pages = (result?.pages ?? [])
        .map(normalizePage)
        .filter((page): page is DocumentScanPage => page !== null);
    if (pages.length === 0) {
        throw new Error("스캔한 문서 이미지를 저장하지 못했습니다.");
    }

    const capturedPageCount = typeof result?.capturedPageCount === "number"
        && Number.isFinite(result.capturedPageCount)
        ? Math.max(pages.length, Math.round(result.capturedPageCount))
        : pages.length;
    return { pages, capturedPageCount };
}

export async function discardDocumentScanPages(uris: string[]): Promise<void> {
    if (!nativeDocumentScanner?.discard) return;
    const normalized = Array.from(new Set(uris.map((uri) => uri.trim()).filter(Boolean)));
    if (normalized.length === 0) return;
    await nativeDocumentScanner.discard(normalized);
}
