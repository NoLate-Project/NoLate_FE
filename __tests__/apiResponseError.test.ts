import {
    ApiResponseError,
    assertApiSuccess,
    unwrapApiResponse,
} from "../src/api/response";
import { getAuthErrorPresentation } from "../src/modules/auth/authErrorMessage";

describe("API error contract", () => {
    test("preserves the backend error code when unwrapping a failure envelope", () => {
        expect.assertions(2);

        try {
            unwrapApiResponse({
                success: false,
                errorMessage: "같은 이메일의 기존 계정이 있습니다.",
                errorCode: "M007",
            });
        } catch (error) {
            expect(error).toBeInstanceOf(ApiResponseError);
            expect((error as ApiResponseError).errorCode).toBe("M007");
        }
    });

    test("preserves codes for empty success assertions and presents account-link guidance", () => {
        let captured: unknown;
        try {
            assertApiSuccess({
                success: false,
                errorMessage: "계정 연결이 필요합니다.",
                errorCode: "M007",
            });
        } catch (error) {
            captured = error;
        }

        expect(getAuthErrorPresentation(captured, "social-signup")).toEqual({
            title: "기존 계정으로 로그인해 주세요",
            message: "같은 이메일로 가입된 계정이 있어요. 기존 로그인 방식을 이용해 주세요.",
        });
        expect(getAuthErrorPresentation(captured, "signup")).toEqual({
            title: "기존 계정으로 로그인해 주세요",
            message: "같은 이메일로 가입된 계정이 있어요. 기존 로그인 방식을 이용해 주세요.",
        });
    });
});
