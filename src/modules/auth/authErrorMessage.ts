export type AuthErrorContext =
    | "login"
    | "signup"
    | "social-login"
    | "social-signup";

type AuthErrorPresentation = {
    title: string;
    message: string;
};

export function isAuthCancellation(error: unknown): boolean {
    const text = getErrorSearchText(error);
    return /err_request_canceled|user[_ -]?cancel|cancelled|canceled|사용자.{0,8}취소|로그인.{0,8}취소/i.test(text);
}

export function getAuthErrorPresentation(
    error: unknown,
    context: AuthErrorContext,
    providerName?: string,
): AuthErrorPresentation {
    const text = getErrorSearchText(error);

    if (/network error|network request failed|econn|timed? ?out|timeout|offline|internet|네트워크|인터넷|연결.{0,8}(실패|없)/i.test(text)) {
        return {
            title: "연결을 확인해 주세요",
            message: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        };
    }

    if (context === "login") {
        return {
            title: "로그인을 확인해 주세요",
            message: "이메일 또는 비밀번호를 다시 확인해 주세요.",
        };
    }

    if (/M007|ACCOUNT_LINK_REQUIRED|같은 이메일의 기존 계정/i.test(text)) {
        return {
            title: "기존 계정으로 로그인해 주세요",
            message: "같은 이메일로 가입된 계정이 있어요. 기존 로그인 방식을 이용해 주세요.",
        };
    }

    if (context === "signup") {
        const duplicateEmail = /M002|M008|M009|duplicate|already.{0,20}(email|member|register)|email.{0,20}(exist|used)|이미.{0,12}(가입|사용)|이메일.{0,12}(중복|존재)/i.test(text);
        return {
            title: "회원가입을 확인해 주세요",
            message: duplicateEmail
                ? "이미 가입된 이메일입니다. 로그인하거나 다른 이메일을 사용해 주세요."
                : "입력 내용을 확인한 뒤 다시 시도해 주세요.",
        };
    }

    const provider = providerName ? `${providerName} ` : "SNS ";
    return context === "social-signup"
        ? {
            title: "가입을 완료하지 못했어요",
            message: "잠시 후 다시 시도해 주세요. 문제가 계속되면 다른 로그인 방법을 이용해 주세요.",
        }
        : {
            title: "계정 연결을 완료하지 못했어요",
            message: `${provider}로그인을 다시 시도해 주세요. 문제가 계속되면 다른 로그인 방법을 이용해 주세요.`,
        };
}

function getErrorSearchText(error: unknown): string {
    if (error instanceof Error) {
        const record = error as Error & {
            errorCode?: unknown;
            code?: unknown;
            status?: unknown;
            cause?: unknown;
        };
        const cause = "cause" in error ? getErrorSearchText(error.cause) : "";
        return [
            error.name,
            error.message,
            record.errorCode,
            record.code,
            record.status,
            cause,
        ].map((value) => typeof value === "string" || typeof value === "number" ? String(value) : "")
            .join(" ");
    }
    if (typeof error === "string" || typeof error === "number") return String(error);
    if (!error || typeof error !== "object") return "";

    const record = error as Record<string, unknown>;
    return [
        record.name,
        record.message,
        record.errorMessage,
        record.code,
        record.errorCode,
        record.status,
    ].map((value) => typeof value === "string" || typeof value === "number" ? String(value) : "")
        .join(" ");
}
