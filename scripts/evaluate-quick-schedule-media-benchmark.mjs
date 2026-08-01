import fs from "node:fs";

import { wilsonLowerBound } from "./quick-schedule-reliability-metrics.mjs";

const CHANNELS = ["TEXT", "PHOTO", "VOICE"];
const MEDIA_CHANNELS = ["PHOTO", "VOICE"];
const PLATFORMS = ["IOS", "ANDROID"];

function option(name, fallback) {
    const prefix = `--${name}=`;
    const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
    return raw === undefined ? fallback : Number(raw);
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

const file = process.argv[2];
if (!file || file.startsWith("--")) {
    console.error("Usage: npm run evaluate:quick-schedule-media -- <results.jsonl> [--target=0.90]");
    process.exit(2);
}

const target = option("target", 0.90);
const minimumPerChannel = option("min-per-channel", 300);
const minimumPerPlatformChannel = option("min-per-platform-channel", 100);
const confidenceZ = option("confidence-z", 1.96);
const validateOnly = hasFlag("validate-only");
if (![target, minimumPerChannel, minimumPerPlatformChannel, confidenceZ].every(Number.isFinite)) {
    throw new Error("Benchmark options must be finite numbers.");
}
if (
    target <= 0 ||
    target > 1 ||
    minimumPerChannel < 1 ||
    minimumPerPlatformChannel < 1 ||
    confidenceZ <= 0
) {
    throw new Error("Target must be 0..1 and sample minimums must be positive.");
}

const rows = fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
        try {
            return JSON.parse(line);
        } catch (error) {
            throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
        }
    });

function normalize(value) {
    return typeof value === "string"
        ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR")
        : "";
}

function exact(row) {
    return ["date", "time", "destination"].every(
        (field) => normalize(row.expected?.[field]) === normalize(row.actual?.[field])
            && normalize(row.expected?.[field]) !== "",
    );
}

function percent(value) {
    return `${(value * 100).toFixed(1)}%`;
}

const failures = [];
for (const [index, row] of rows.entries()) {
    if (!CHANNELS.includes(row.channel)) failures.push(`line ${index + 1}: invalid channel`);
    if (!PLATFORMS.includes(row.platform)) failures.push(`line ${index + 1}: invalid platform`);
    if (!Number.isFinite(row.confidence?.overall)
        || row.confidence.overall < 0
        || row.confidence.overall > 1) {
        failures.push(`line ${index + 1}: confidence.overall must be 0..1`);
    }
    if (!["HIGH", "MEDIUM", "REVIEW"].includes(row.confidence?.level)) {
        failures.push(`line ${index + 1}: invalid confidence.level`);
    }
}
if (failures.length > 0) {
    console.error("Quick-schedule result contract validation FAILED:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
}
if (validateOnly) {
    console.log(`Quick-schedule result contract validation PASSED: n=${rows.length}`);
    process.exit(0);
}

const scored = rows.map((row) => ({ ...row, exact: exact(row) }));
function metric(label, subset, minimum) {
    const successes = subset.filter((row) => row.exact).length;
    const accuracy = subset.length === 0 ? 0 : successes / subset.length;
    const lowerBound = subset.length === 0
        ? 0
        : wilsonLowerBound(successes, subset.length, confidenceZ);
    console.log(
        `${label}: n=${subset.length}, exact=${percent(accuracy)}, ` +
        `95% Wilson lower=${percent(lowerBound)}`,
    );
    if (subset.length < minimum) failures.push(`${label}: requires at least ${minimum} samples`);
    if (lowerBound < target) {
        failures.push(
            `${label}: ${percent(lowerBound)} statistical lower bound is below ${percent(target)}`,
        );
    }
}

metric("overall", scored, minimumPerChannel * CHANNELS.length);
for (const channel of CHANNELS) {
    metric(channel, scored.filter((row) => row.channel === channel), minimumPerChannel);
}
for (const channel of MEDIA_CHANNELS) {
    for (const platform of PLATFORMS) {
        metric(
            `${platform}/${channel}`,
            scored.filter((row) => row.channel === channel && row.platform === platform),
            minimumPerPlatformChannel,
        );
    }
}

const high = scored.filter((row) => row.confidence?.level === "HIGH");
const highSuccesses = high.filter((row) => row.exact).length;
const highPrecision = high.length === 0 ? 0 : highSuccesses / high.length;
const highPrecisionLowerBound = high.length === 0
    ? 0
    : wilsonLowerBound(highSuccesses, high.length, confidenceZ);
console.log(
    `HIGH precision: n=${high.length}, exact=${percent(highPrecision)}, ` +
    `95% Wilson lower=${percent(highPrecisionLowerBound)}`,
);
if (high.length === 0) failures.push("HIGH precision: no accepted samples");
if (highPrecisionLowerBound < target) {
    failures.push(`HIGH precision statistical lower bound is below ${percent(target)}`);
}
const unsafeHigh = high.filter((row) => !row.exact);
if (unsafeHigh.length > 0) {
    failures.push(`unsafe HIGH results: ${unsafeHigh.slice(0, 20).map((row) => row.id).join(", ")}`);
}

// Expected calibration error verifies that displayed percentages roughly match observed correctness.
const bins = new Map();
for (const row of scored) {
    const key = Math.min(9, Math.floor(row.confidence.overall * 10));
    const bin = bins.get(key) ?? [];
    bin.push(row);
    bins.set(key, bin);
}
const calibrationError = [...bins.values()].reduce((total, bin) => {
    const predicted = bin.reduce((sum, row) => sum + row.confidence.overall, 0) / bin.length;
    const observed = bin.filter((row) => row.exact).length / bin.length;
    return total + Math.abs(predicted - observed) * (bin.length / scored.length);
}, 0);
console.log(`calibration error: ${percent(calibrationError)} (limit 10.0%)`);
if (calibrationError > 0.10) failures.push("confidence calibration error exceeds 10.0%");

if (failures.length > 0) {
    console.error("\nQuick-schedule raw-media gate FAILED:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
}
console.log("\nQuick-schedule raw-media gate PASSED.");
