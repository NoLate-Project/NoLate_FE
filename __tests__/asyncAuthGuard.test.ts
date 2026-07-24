import { createAsyncAuthGuard } from "../src/modules/auth/asyncAuthGuard";

test("logout epoch 또는 화면 generation이 바뀌면 늦은 응답을 거부한다", () => {
    let epoch = 4;
    const guard = createAsyncAuthGuard(() => epoch);
    const beforeLogout = guard.capture();
    epoch += 1;
    expect(guard.isCurrent(beforeLogout)).toBe(false);

    const beforeRouteChange = guard.capture();
    guard.invalidate();
    expect(guard.isCurrent(beforeRouteChange)).toBe(false);

    const beforeUnmount = guard.capture();
    guard.dispose();
    expect(guard.isCurrent(beforeUnmount)).toBe(false);
});
