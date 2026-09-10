/**
 * Account Model — Domain Types & Parsers (CHAMPS)
 *
 * Pure domain types, parsing, and form-state builders.
 * No React. No API. No side-effects.
 */

// ─── Domain Types ───────────────────────────────────────────

export interface Account {
    id: string;
    name: string;
    segment: string;
    address?: string;
    contact: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        agentId?: string;
        city?: string;
        state?: string;
        zip?: string;
    };
    policies: {
        id: string;
        policyNumber: string;
        status: string;
    }[];
    createdAt: string;
    bankAccounts?: {
        bankName: string;
        accountNumber: string;
        routingNumber: string;
    }[];
}

export type AccountFormState = {
    name: string;
    segment: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    agentId: string;
    bankAccounts: { bankName: string; accountNumber: string; routingNumber: string }[];
};

// ─── Parsers ────────────────────────────────────────────────

export function parseRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

export function toAccount(value: unknown): Account | null {
    const record = parseRecord(value);
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    if (!id || !name) return null;
    const contactRecord = parseRecord(record.contact);
    const bankAccountsRaw = Array.isArray(record.bankAccounts) ? record.bankAccounts : [];
    const policiesRaw = Array.isArray(record.policies) ? record.policies : [];
    const policies = policiesRaw
        .map((item) => {
            const policy = parseRecord(item);
            const policyId = typeof policy.id === 'string' ? policy.id : '';
            const policyNumber = typeof policy.policyNumber === 'string' ? policy.policyNumber : '';
            const status = typeof policy.status === 'string' ? policy.status : '';
            if (!policyId || !policyNumber || !status) return null;
            return { id: policyId, policyNumber, status };
        })
        .filter((item): item is Account['policies'][number] => Boolean(item));

    return {
        id,
        name,
        segment: typeof record.segment === 'string' ? record.segment : '',
        address: typeof record.address === 'string' ? record.address : undefined,
        contact: {
            firstName: typeof contactRecord.firstName === 'string' ? contactRecord.firstName : undefined,
            lastName: typeof contactRecord.lastName === 'string' ? contactRecord.lastName : undefined,
            email: typeof contactRecord.email === 'string' ? contactRecord.email : undefined,
            phone: typeof contactRecord.phone === 'string' ? contactRecord.phone : undefined,
            agentId: typeof contactRecord.agentId === 'string' ? contactRecord.agentId : undefined,
            city: typeof contactRecord.city === 'string' ? contactRecord.city : undefined,
            state: typeof contactRecord.state === 'string' ? contactRecord.state : undefined,
            zip: typeof contactRecord.zip === 'string' ? contactRecord.zip : undefined,
        },
        policies,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
        bankAccounts: bankAccountsRaw
            .map((item) => {
                const bank = parseRecord(item);
                return {
                    bankName: typeof bank.bankName === 'string' ? bank.bankName : '',
                    accountNumber: typeof bank.accountNumber === 'string' ? bank.accountNumber : '',
                    routingNumber: typeof bank.routingNumber === 'string' ? bank.routingNumber : '',
                };
            })
            .filter((b) => b.bankName || b.accountNumber || b.routingNumber),
    };
}

// ─── Form State Builders ────────────────────────────────────

export const EMPTY_ACCOUNT_FORM: AccountFormState = {
    name: '',
    segment: 'Real Estate',
    address: '',
    city: '',
    state: '',
    zip: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    agentId: '',
    bankAccounts: [],
};

export function toAccountFormState(account: Account): AccountFormState {
    return {
        name: account.name,
        segment: account.segment,
        address: account.address || '',
        city: account.contact.city || '',
        state: account.contact.state || '',
        zip: account.contact.zip || '',
        firstName: account.contact.firstName || '',
        lastName: account.contact.lastName || '',
        email: account.contact.email || '',
        phone: account.contact.phone || '',
        agentId: account.contact.agentId || '',
        bankAccounts: account.bankAccounts || [],
    };
}

export function buildAccountPayload(form: AccountFormState) {
    return {
        name: form.name,
        segment: form.segment,
        address: form.address,
        contact: {
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email,
            phone: form.phone,
            agentId: form.agentId,
            city: form.city,
            state: form.state,
            zip: form.zip,
        },
        bankAccounts: form.bankAccounts,
    };
}
