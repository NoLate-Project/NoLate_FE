import type { MemberDto } from "../../api/member";
import {
    prepareAuthRestoreRequest,
    saveRestoredAuthSessionIfCurrent,
    type AuthRestoreContext,
} from "./authStorage";

export async function restoreAuthSessionIfCurrent(options: {
    context: AuthRestoreContext;
    tokenLogin: (refreshToken: string) => Promise<MemberDto>;
}): Promise<MemberDto | undefined> {
    const prepared = await prepareAuthRestoreRequest(options.context);
    if (!prepared) return undefined;
    const member = await options.tokenLogin(
        options.context.expectedRefreshToken,
    );
    const restored = await saveRestoredAuthSessionIfCurrent({
        context: options.context,
        member,
    });
    return restored ? member : undefined;
}
