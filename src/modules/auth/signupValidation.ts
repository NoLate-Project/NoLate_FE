export const MAX_SIGNUP_NAME_LENGTH = 20;
export const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
