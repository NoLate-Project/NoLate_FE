export function shouldHandleSignupAgreementHardwareBack({
    platform,
    isFocused,
    isAgreementStep,
}: {
    platform: string;
    isFocused: boolean;
    isAgreementStep: boolean;
}): boolean {
    return platform === "android" && isFocused && isAgreementStep;
}

export function handleSignupAgreementHardwareBack({
    submitting,
    returnToDetails,
}: {
    submitting: boolean;
    returnToDetails: () => void;
}): true {
    if (!submitting) returnToDetails();
    return true;
}
