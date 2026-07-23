import { Redirect } from "expo-router";

import { useAuth } from "../src/modules/auth/AuthContext";
import { getPostAuthRoute } from "../src/modules/onboarding/curationRouting";

export default function Index() {
    const { isAuthenticated, isCurationCompleted } = useAuth();

    if (!isAuthenticated) return <Redirect href="/auth/login" />;
    return <Redirect href={getPostAuthRoute(isCurationCompleted)} />;
}
