import assert from "node:assert/strict";
import test from "node:test";

import { wilsonLowerBound } from "./quick-schedule-reliability-metrics.mjs";

test("30 perfect deterministic cases are not enough to certify 90% at 95% confidence", () => {
    assert.ok(wilsonLowerBound(30, 30) < 0.90);
});

test("35 perfect cases clear the 90% lower-bound threshold", () => {
    assert.ok(wilsonLowerBound(35, 35) >= 0.90);
});

test("an operational 300-case channel needs at least 281 exact results", () => {
    assert.ok(wilsonLowerBound(280, 300) < 0.90);
    assert.ok(wilsonLowerBound(281, 300) >= 0.90);
});

test("rejects impossible counts", () => {
    assert.throws(() => wilsonLowerBound(2, 1), RangeError);
    assert.throws(() => wilsonLowerBound(0, 0), RangeError);
});
