import { getPostAuthRoute } from "../src/modules/onboarding/curationRouting";

describe("curation routing", () => {
    test("completed members enter the schedule", () => {
        expect(getPostAuthRoute(true)).toBe("/schedule");
    });

    test.each([false, null, undefined])("incomplete or unknown state enters curation: %p", (value) => {
        expect(getPostAuthRoute(value)).toBe("/onboarding/calendar-import");
    });
});
