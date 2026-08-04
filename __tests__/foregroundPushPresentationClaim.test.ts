import AsyncStorage from "@react-native-async-storage/async-storage";

import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    activateForegroundPushPresentationClaimsForAuthenticatedMember,
    clearForegroundPushPresentationClaimsForCurrentAccount,
    FOREGROUND_PUSH_PRESENTATION_CLAIM_TEST_CONSTANTS,
    presentForegroundPushOnce,
    resetForegroundPushPresentationClaimsForTests,
} from "../src/modules/notification/foregroundPushPresentationClaim";

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { HEX: "hex" },
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) => {
        const { createHash } = require("crypto") as typeof import("crypto");
        return createHash("sha256").update(value, "utf8").digest("hex");
    }),
}));

const mockedGetAuthMember = jest.mocked(getAuthMember);
const constants = FOREGROUND_PUSH_PRESENTATION_CLAIM_TEST_CONSTANTS!;
const NOW = Date.parse("2026-08-04T05:00:00.000Z");

function canonicalData(
    logicalEventKey = "event:00000000-0000-4000-8000-000000000041",
): Record<string, unknown> {
    return {
        type: "SCHEDULE_DEPARTURE_REMINDER",
        recipientMemberId: "7",
        logicalEventKey,
        etaEventExpiresAt: "2026-08-04T05:02:00.000Z",
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe("foreground push durable presentation claim", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        resetForegroundPushPresentationClaimsForTests();
        mockedGetAuthMember.mockResolvedValue({ id: 7 } as Awaited<
            ReturnType<typeof getAuthMember>
        >);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("lets only one concurrent delivery present and survives process-state reset", async () => {
        const present = jest.fn(async () => true);

        const results = await Promise.all([
            presentForegroundPushOnce(canonicalData(), "provider-a", present, NOW),
            presentForegroundPushOnce(canonicalData(), "provider-b", present, NOW),
        ]);

        expect(results.sort()).toEqual(["duplicate", "presented"]);
        expect(present).toHaveBeenCalledTimes(1);
        const identifier = present.mock.calls[0][0];
        expect(identifier).toMatch(/^nolate-visible-[0-9a-f]{64}$/);
        expect(identifier).not.toContain("000000000041");

        resetForegroundPushPresentationClaimsForTests();
        await expect(presentForegroundPushOnce(
            canonicalData(),
            "provider-c",
            present,
            NOW + 1,
        )).resolves.toBe("duplicate");
        expect(present).toHaveBeenCalledTimes(1);
    });

    it("uses distinct stable OS identifiers for distinct logical events", async () => {
        const present = jest.fn(async () => true);
        const second = "event:00000000-0000-4000-8000-000000000042";

        await expect(presentForegroundPushOnce(
            canonicalData(), "provider-a", present, NOW,
        )).resolves.toBe("presented");
        await expect(presentForegroundPushOnce(
            canonicalData(second), "provider-a", present, NOW,
        )).resolves.toBe("presented");

        expect(present).toHaveBeenCalledTimes(2);
        expect(present.mock.calls[0][0]).not.toBe(present.mock.calls[1][0]);
    });

    it("rolls a pending claim back after an explicit scheduling failure", async () => {
        const failure = new Error("OS scheduling failed");
        await expect(presentForegroundPushOnce(
            canonicalData(),
            "provider-a",
            jest.fn(async () => { throw failure; }),
            NOW,
        )).rejects.toBe(failure);

        const retry = jest.fn(async () => true);
        await expect(presentForegroundPushOnce(
            canonicalData(), "provider-a", retry, NOW + 1,
        )).resolves.toBe("presented");
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it("reclaims a stale pending lease with the same opaque OS identifier", async () => {
        const firstAcceptance = deferred<boolean>();
        const firstPresenter = jest.fn(() => firstAcceptance.promise);
        const first = presentForegroundPushOnce(
            canonicalData(), "provider-a", firstPresenter, NOW,
        );
        while (firstPresenter.mock.calls.length === 0) await Promise.resolve();
        const firstIdentifier = firstPresenter.mock.calls[0][0];

        // Model a process death: memory-only flight state disappears while durable PENDING stays.
        resetForegroundPushPresentationClaimsForTests();
        const replayPresenter = jest.fn(async () => true);
        await expect(presentForegroundPushOnce(
            canonicalData(),
            "provider-a",
            replayPresenter,
            NOW + constants.pendingLeaseMs,
        )).resolves.toBe("presented");
        expect(replayPresenter).toHaveBeenCalledWith(firstIdentifier);

        firstAcceptance.resolve(false);
        await expect(first).resolves.toBe("rejected");
        resetForegroundPushPresentationClaimsForTests();
        await expect(presentForegroundPushOnce(
            canonicalData(),
            "provider-a",
            jest.fn(async () => true),
            NOW + constants.pendingLeaseMs + 1,
        )).resolves.toBe("duplicate");
    });

    it("fails closed for stale, malformed, or cross-account payloads", async () => {
        const present = jest.fn(async () => true);
        const stale = { ...canonicalData(), etaEventExpiresAt: "2026-08-04T04:59:59Z" };
        const malformed = { ...canonicalData(), etaEventExpiresAt: "not-a-date" };
        const crossAccount = { ...canonicalData(), recipientMemberId: "8" };

        await expect(presentForegroundPushOnce(stale, "p1", present, NOW))
            .resolves.toBe("rejected");
        await expect(presentForegroundPushOnce(malformed, "p2", present, NOW))
            .resolves.toBe("rejected");
        await expect(presentForegroundPushOnce(crossAccount, "p3", present, NOW))
            .resolves.toBe("rejected");
        await expect(presentForegroundPushOnce({}, undefined, present, NOW))
            .resolves.toBe("rejected");
        expect(present).not.toHaveBeenCalled();
    });

    it("fails open after verified identity when durable storage is unavailable", async () => {
        jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(
            new Error("storage unavailable"),
        );
        const present = jest.fn(async () => true);

        await expect(presentForegroundPushOnce(
            canonicalData(), "provider-a", present, NOW,
        )).resolves.toBe("presented");
        expect(present).toHaveBeenCalledTimes(1);
    });

    it("supports legacy provider identity and fences account cleanup until activation", async () => {
        const present = jest.fn(async () => true);
        await expect(presentForegroundPushOnce(
            { type: "LEGACY_VISIBLE_PUSH" },
            "0:legacy%provider-id",
            present,
            NOW,
        )).resolves.toBe("presented");
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).not.toBeNull();

        await clearForegroundPushPresentationClaimsForCurrentAccount();
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
        await expect(presentForegroundPushOnce(
            { type: "LEGACY_VISIBLE_PUSH" },
            "another-provider-id",
            present,
            NOW + 1,
        )).resolves.toBe("rejected");

        await expect(activateForegroundPushPresentationClaimsForAuthenticatedMember())
            .resolves.toBe(true);
        await expect(presentForegroundPushOnce(
            { type: "LEGACY_VISIBLE_PUSH" },
            "another-provider-id",
            present,
            NOW + 2,
        )).resolves.toBe("presented");
    });

    it("prunes expired entries and keeps the account envelope bounded", async () => {
        const present = jest.fn(async () => true);
        for (let index = 0; index < constants.maximumSize + 2; index += 1) {
            const suffix = index.toString(16).padStart(12, "0");
            await presentForegroundPushOnce(
                canonicalData(`event:00000000-0000-4000-8000-${suffix}`),
                `provider-${index}`,
                present,
                NOW + index,
            );
        }
        const envelope = JSON.parse(
            (await AsyncStorage.getItem(constants.storageKeyForMember(7)))!,
        ) as { entries: unknown[] };
        expect(envelope.entries).toHaveLength(constants.maximumSize);

        const afterTtl = NOW + constants.claimTtlMs + constants.maximumSize + 3;
        await expect(presentForegroundPushOnce(
            canonicalData(), "provider-fresh", present, afterTtl,
        )).resolves.toBe("rejected");
        // The ETA payload itself expired; no old dedupe entry is allowed to turn that into a
        // false presentation success.
        expect(present).toHaveBeenCalledTimes(constants.maximumSize + 2);
    });
});
