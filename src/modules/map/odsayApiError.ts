/** Keep provider error identity independent of networking/native modules. */
export class OdsayApiError extends Error {
    constructor(readonly providerCode: string | undefined, message: string) {
        super(message);
        this.name = "OdsayApiError";
    }
}
