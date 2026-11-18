export const MAX_SIGNUP_NAME_LENGTH = 20;
export const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_PATTERN = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*])[a-zA-Z\d!@#$%^&*]{8,16}$/;
export const SIGNUP_FIELDS = ["name", "email", "password", "confirmation"] as const;
export type SignupField = typeof SIGNUP_FIELDS[number];
export type SignupFieldErrors = Partial<Record<SignupField, string>>;

export function getSignupFieldErrors(values: Record<SignupField, string>): SignupFieldErrors {
    const errors: SignupFieldErrors = {};
    if (!values.name.trim()) errors.name = "이름을 입력해 주세요.";
    else if (!isValidSignupName(values.name)) errors.name = `이름은 ${MAX_SIGNUP_NAME_LENGTH}자 이하로 입력해 주세요.`;

    if (!values.email.trim()) errors.email = "이메일을 입력해 주세요.";
    else if (!isValidSignupEmail(values.email)) errors.email = "올바른 이메일 주소를 입력해 주세요.";

    if (!PASSWORD_PATTERN.test(values.password)) errors.password = "영문, 숫자, !@#$%^&* 조합으로 8~16자를 입력해 주세요.";
    if (!values.confirmation) errors.confirmation = "비밀번호를 한 번 더 입력해 주세요.";
    else if (values.password !== values.confirmation) errors.confirmation = "비밀번호가 일치하지 않아요.";
    return errors;
}

export function normalizeSignupEmail(value: string): string {
    return value.trim().toLowerCase();
}

export function isValidSignupEmail(value: string): boolean {
    const email = normalizeSignupEmail(value);
    return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

export function isValidSignupName(value: string): boolean {
    const name = value.trim();
    return name.length > 0 &&
        name.length <= MAX_SIGNUP_NAME_LENGTH &&
        !Array.from(name).some((character) => {
            const code = character.charCodeAt(0);
            return code <= 31 || code === 127;
        });
}
