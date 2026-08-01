export function wilsonLowerBound(successes, total, z = 1.96) {
    if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total)) {
        throw new TypeError("successes and total must be integers");
    }
    if (total <= 0 || successes < 0 || successes > total) {
        throw new RangeError("expected 0 <= successes <= total and total > 0");
    }
    if (!Number.isFinite(z) || z <= 0) throw new RangeError("z must be positive");

    const observed = successes / total;
    const zSquared = z * z;
    const denominator = 1 + zSquared / total;
    const center = observed + zSquared / (2 * total);
    const margin = z * Math.sqrt(
        (observed * (1 - observed) + zSquared / (4 * total)) / total,
    );
    return Math.max(0, (center - margin) / denominator);
}
