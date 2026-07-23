import { getTermsOfService, TERMS_OF_SERVICE_FALLBACK } from "../../src/api/legal";
import LegalAgreementDocumentScreen from "../../src/modules/legal/LegalAgreementDocumentScreen";

export default function TermsOfServiceScreen() {
    return (
        <LegalAgreementDocumentScreen
            fallback={TERMS_OF_SERVICE_FALLBACK}
            loadDocument={getTermsOfService}
        />
    );
}
