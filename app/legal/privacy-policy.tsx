import { getPrivacyPolicy, PRIVACY_POLICY_FALLBACK } from "../../src/api/legal";
import LegalAgreementDocumentScreen from "../../src/modules/legal/LegalAgreementDocumentScreen";

export default function PrivacyPolicyScreen() {
    return (
        <LegalAgreementDocumentScreen
            fallback={PRIVACY_POLICY_FALLBACK}
            loadDocument={getPrivacyPolicy}
            route="/legal/privacy-policy"
            collapsibleSections
        />
    );
}
