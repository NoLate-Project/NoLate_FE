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
    // Transient transport/5xx failures deliberately leave this bounded
    // in-memory context prepared so the same process can retry the exact old
    // refresh credential. If the server rotated it but the response was lost,
    // a later definitive rejection clears the session; no response token is
    // guessed or mixed with the stored credential.
    const member = await options.tokenLogin(
        options.context.expectedRefreshToken,
    );
    const restored = await saveRestoredAuthSessionIfCurrent({
        context: options.context,
        member,
    });
    return restored ? member : undefined;
}
