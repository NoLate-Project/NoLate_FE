import {
    getPrivacyCollectionConsent,
    PRIVACY_COLLECTION_CONSENT_FALLBACK,
} from "../../src/api/legal";
import LegalAgreementDocumentScreen from "../../src/modules/legal/LegalAgreementDocumentScreen";

export default function PrivacyCollectionConsentScreen() {
    return (
        <LegalAgreementDocumentScreen
            fallback={PRIVACY_COLLECTION_CONSENT_FALLBACK}
            loadDocument={getPrivacyCollectionConsent}
        />
    );
}
