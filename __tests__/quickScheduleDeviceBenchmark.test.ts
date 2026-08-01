import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    buildQuickScheduleBenchmarkResult,
    exportQuickScheduleBenchmarkJsonl,
    loadQuickScheduleBenchmarkSession,
    nextQuickScheduleBenchmarkCase,
    parseQuickScheduleBenchmarkManifest,
    recordQuickScheduleBenchmarkResult,
    startQuickScheduleBenchmarkSession,
} from "../src/modules/schedule/quickScheduleDeviceBenchmark";
import type { ScheduleParseResult } from "../src/modules/schedule/types";

const manifest = {
    version: 1 as const,
    cases: [
        {
            id: "text-001",
            channel: "TEXT" as const,
            sourceText: "8월 3일 오후 7시 강남역 회의",
            referenceDate: "2026-08-01",
            expected: { date: "2026-08-03", time: "19:00", destination: "강남역" },
        },
        {
            id: "photo-001",
            channel: "PHOTO" as const,
            mediaAssetId: "opaque-photo-001",
            expected: { date: "2026-08-04", time: "14:00", destination: "서울역" },
        },
    ],
};

function parsedResult(): ScheduleParseResult {
    return {
        date: "2026-08-03",
        time: "19:00",
        destination: { name: "강남역" },
        originSource: "REQUIRED",
        originRequired: true,
        parseSource: "RULE",
        aiAttempted: false,
        needsReview: false,
        warnings: [],
        missingFields: [],
        confidenceVersion: "quick-schedule-v1",
        confidence: {
            overall: 0.94,
            level: "HIGH",
            recognition: 0.92,
            fields: { date: 0.98, time: 0.98, destination: 0.94 },
            reasons: [],
        },
    };
}

describe("quick-schedule device benchmark session", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it("validates channel-specific manifest requirements", () => {
        expect(parseQuickScheduleBenchmarkManifest(JSON.stringify(manifest))).toEqual(manifest);
        expect(() => parseQuickScheduleBenchmarkManifest({
            version: 1,
            cases: [{
                id: "voice-001",
                channel: "VOICE",
                mediaAssetId: "voice-asset",
                expected: { date: "2026-08-03", time: "19:00", destination: "강남역" },
            }],
        })).toThrow("prompt");
    });

    it("exports only opaque identifiers, expected/actual fields, and confidence", async () => {
        let session = await startQuickScheduleBenchmarkSession(manifest);
        const result = buildQuickScheduleBenchmarkResult(
            manifest.cases[0],
            "ANDROID",
            parsedResult(),
            { appVersion: "1.2.0", attemptCount: 2 },
        );
        session = await recordQuickScheduleBenchmarkResult(session, result);

        const jsonl = exportQuickScheduleBenchmarkJsonl(session);
        expect(JSON.parse(jsonl)).toEqual(expect.objectContaining({
            id: "text-001",
            platform: "ANDROID",
            actual: { date: "2026-08-03", time: "19:00", destination: "강남역" },
            confidence: { overall: 0.94, level: "HIGH", recognition: 0.92 },
            attemptCount: 2,
        }));
        expect(jsonl).not.toContain(manifest.cases[0].sourceText);
        expect(nextQuickScheduleBenchmarkCase(session)?.id).toBe("photo-001");
        expect(await loadQuickScheduleBenchmarkSession()).toEqual(session);
    });

    it("fails closed when the server omits confidence", () => {
        const result = buildQuickScheduleBenchmarkResult(
            manifest.cases[0],
            "IOS",
            { ...parsedResult(), confidence: undefined, confidenceVersion: undefined },
        );
        expect(result.confidence).toEqual({ overall: 0, level: "REVIEW" });
        expect(result.confidenceVersion).toBe("missing");
    });
});
