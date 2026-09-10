export type BillingSummary = {
  currency?: string;
  targetAmount?: number;
  paid?: number;
  refunded?: number;
  balance?: number;
  transactions?: BillingTransaction[];
  reconciliation?: { lines?: ReconciliationLine[] };
};

export type BillingTransaction = {
  id: string;
  type: 'CHARGE' | 'REFUND' | 'ADJUSTMENT';
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  reference?: string;
};

export type ReconciliationLine = {
  id: string;
  amount: number;
  status: string;
  matchedAt?: string;
};
