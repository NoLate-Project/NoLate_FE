import {
    isDefinitiveAuthRejection,
    isDefinitiveRefreshStatus,
} from "../src/modules/auth/refreshPolicy";

describe("auth refresh invalidation policy", () => {
    test.each([400, 401, 403, 404])("clears auth only for a definitive %s rejection", (status) => {
        expect(isDefinitiveRefreshStatus(status)).toBe(true);
    });

    test.each([undefined, 408, 429, 500, 502, 503])("keeps auth for transient status %s", (status) => {
        expect(isDefinitiveRefreshStatus(status)).toBe(false);
    });

    test("recognizes the status preserved on API errors", () => {
        expect(isDefinitiveAuthRejection({ status: 404 })).toBe(true);
        expect(isDefinitiveAuthRejection({ status: 503 })).toBe(false);
        expect(isDefinitiveAuthRejection(new Error("offline"))).toBe(false);
    });
});
