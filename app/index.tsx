import { Redirect } from "expo-router";

import { useAuth } from "../src/modules/auth/AuthContext";

export default function Index() {
    const { isAuthenticated } = useAuth();

    return <Redirect href={isAuthenticated ? "/schedule" : "/auth/login"} />;
}
