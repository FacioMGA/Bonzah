/**
 * Billing Types Definition (Draft)
 * 
 * Future Schema Considerations:
 * - Invoice (id, policyId, amount, currency, status, dueDate, pdfUrl)
 * - LedgerEntry (transactionId, type, amount, balanceAfter)
 * - PaymentMethod (tokenized)
 */

export interface Invoice {
    id: string;
    invoiceNumber: string;
    policyId: string;
    issuer: {
        name: string;
        taxId?: string;
        address: string;
    };
    recipient: {
        name: string;
        address: string;
    };
    items: InvoiceItem[];
    subtotal: number;
    tax: number;
    total: number;
    currency: string;
    issuedAt: string;
    dueAt: string;
    status: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID' | 'OVERDUE';
    pdfUrl?: string; // Generated PDF
}

export interface InvoiceItem {
    description: string;
    amount: number; // Net
    taxRate?: number;
    taxAmount?: number;
}

/**
 * Proposed Billing logic:
 * 1. On Policy Bind -> Generate Invoice (ISSUED)
 * 2. On MTA Bind (Additional Premium) -> Generate Invoice (ISSUED)
 * 3. On Payment -> Update Invoice Status (PAID) + Create LedgerEntry
 * 4. On Refund -> Generate Credit Note (Negative Invoice)
 */

export const BillingConstants = {
    DEFAULT_DUE_DAYS: 14,
    TAX_RATE_CY: 0.19 // VAT if applicable, or IPT logic
};
