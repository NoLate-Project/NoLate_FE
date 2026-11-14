import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

const emptyLogin = () => ({ email: "", password: "" });
const emptySignup = () => ({ name: "", email: "", password: "", confirmation: "" });
type LoginDraft = ReturnType<typeof emptyLogin>;
type SignupDraft = ReturnType<typeof emptySignup>;

const AuthFormDraftsContext = createContext<{
    login: LoginDraft;
    signup: SignupDraft;
    setLogin: Dispatch<SetStateAction<LoginDraft>>;
    setSignup: Dispatch<SetStateAction<SignupDraft>>;
    clear: () => void;
} | null>(null);

export function AuthFormDraftsProvider({ children }: { children: ReactNode }) {
    const [login, setLogin] = useState(emptyLogin);
    const [signup, setSignup] = useState(emptySignup);
    const [clear] = useState(() => () => {
        setLogin(emptyLogin());
        setSignup(emptySignup());
    });

    return (
        <AuthFormDraftsContext.Provider value={{ login, signup, setLogin, setSignup, clear }}>
            {children}
        </AuthFormDraftsContext.Provider>
    );
}

export function useAuthFormDrafts() {
    const drafts = useContext(AuthFormDraftsContext);
    if (!drafts) throw new Error("Auth forms require AuthFormDraftsProvider");
    return drafts;
}
