import {
    handleSignupAgreementHardwareBack,
    shouldHandleSignupAgreementHardwareBack,
} from "../src/modules/auth/signupNavigation";

describe("signup agreement hardware back", () => {
    test("intercepts Android back only while the agreements step is focused", () => {
        expect(shouldHandleSignupAgreementHardwareBack({
            platform: "android",
            isFocused: true,
            isAgreementStep: true,
        })).toBe(true);
        expect(shouldHandleSignupAgreementHardwareBack({
            platform: "android",
            isFocused: true,
            isAgreementStep: false,
        })).toBe(false);
        expect(shouldHandleSignupAgreementHardwareBack({
            platform: "android",
            isFocused: false,
            isAgreementStep: true,
        })).toBe(false);
        expect(shouldHandleSignupAgreementHardwareBack({
            platform: "ios",
            isFocused: true,
            isAgreementStep: true,
        })).toBe(false);
    });

    test("returns to details while idle and still consumes back during submission", () => {
        const returnToDetails = jest.fn();

        expect(handleSignupAgreementHardwareBack({ submitting: false, returnToDetails }))
            .toBe(true);
        expect(returnToDetails).toHaveBeenCalledTimes(1);

        expect(handleSignupAgreementHardwareBack({ submitting: true, returnToDetails }))
            .toBe(true);
        expect(returnToDetails).toHaveBeenCalledTimes(1);
    });
});
