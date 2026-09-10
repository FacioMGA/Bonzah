import React from 'react';
import type { RecordListConfig } from '@/src/shared/core/recordList/types';
import { validateRecordListConfig } from '@/src/shared/core/recordList/schema';
import type { PolicyListItem } from './policiesAdapter';
import { createPolicyColumns } from './policyColumns';
import { policyListRegistry } from './policyListRegistry';
import { getPersonalizedPolicySmartSorts } from './policiesPersonalization';
import { PolicyCardList } from '@/src/shared/core/recordList/ui/PolicyCardList';
import { asRecord } from '@/src/shared/lib/record';
import { humanizePolicyStatus } from '../model/policyDisplayLabels';


export type PoliciesListConfigOptions = {
  onRequestDeletePolicy?: (e: React.MouseEvent, id: string) => void;
  /** Program label/value pairs used by the chip and the in-modal selector.
   *  When empty, `RecordListView`'s active-filter chip falls back to the raw
   *  UUID — load these as soon as the list mounts. */
  programOptions?: Array<{ label: string; value: string }>;
  binderOptions?: Array<{ label: string; value: string }>;
};

export function createPoliciesListConfig(opts: PoliciesListConfigOptions): RecordListConfig<PolicyListItem> {
  const statuses = policyListRegistry.filters.status.options || [];
  const boolFilterIds = ['needsAttention', 'hasOpenClaim', 'cancellationPending', 'customerActionRequired', 'uwActionRequired'];
  const rangeFilterDefs = [
    { id: 'totalPremium_between', registryKey: 'totalPremium', type: 'number-range' as const, placeholder: 'Min..Max' },
    { id: 'expiryDate_between', registryKey: 'expiryDate', type: 'date-range' as const, placeholder: 'From..To' },
    { id: 'quoteExpiryDate_between', registryKey: 'quoteExpiryDate', type: 'date-range' as const, placeholder: 'From..To' },
    { id: 'lastActivityAt_between', registryKey: 'lastActivityAt', type: 'date-range' as const, placeholder: 'From..To' },
  ];

  return validateRecordListConfig({
    id: 'policies',
    entityLabel: 'Policies',
    getRowId: (p: PolicyListItem) => String(p.id),
    searchPlaceholder: 'Search policies…',
    searchHint: 'Create, review, and manage policies and submissions.',
    getSmartSortFallback: getPersonalizedPolicySmartSorts,
    rowHref: (p: PolicyListItem) => (p?.id ? `/policies/${String(p.id)}` : undefined),
    columns: createPolicyColumns(opts),
    filters: [
      {
        id: 'status',
        label: policyListRegistry.filters.status.label || 'Status',
        type: 'select',
        placeholder: 'All statuses',
        defaultValue: '',
        urlKey: policyListRegistry.filters.status.urlKey || 'status',
        options: statuses.map((s) => ({ label: humanizePolicyStatus(s), value: s })),
      },
      {
        id: 'program_in',
        label: policyListRegistry.filters['program']?.label || 'Program',
        type: 'select',
        placeholder: 'All programs',
        defaultValue: '',
        urlKey: policyListRegistry.filters['program']?.urlKey || 'program_id',
        options: opts.programOptions || [],
      },
      {
        id: 'binder',
        label: policyListRegistry.filters['binder']?.label || 'Binder',
        type: 'select',
        placeholder: 'All binders',
        defaultValue: '',
        urlKey: policyListRegistry.filters['binder']?.urlKey || 'binder_id',
        options: opts.binderOptions || [],
      },
      ...boolFilterIds
        .map((id) => {
          const f = policyListRegistry.filters[id];
          if (!f) return null;
          return {
            id,
            label: f.label || id,
            type: 'select' as const,
            placeholder: 'All',
            defaultValue: '',
            urlKey: f.urlKey || id,
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
            ],
          };
        })
        .filter((x): x is { id: string; label: string; type: 'select'; placeholder: string; defaultValue: string; urlKey: string; options: Array<{ label: string; value: string }> } => Boolean(x)),
      ...rangeFilterDefs
        .map((x) => {
          const f = policyListRegistry.filters[x.registryKey];
          if (!f) return null;
          return {
            id: x.id,
            label: x.registryKey === 'expiryDate' ? 'Renewal Date' : (f.label || x.registryKey),
            type: x.type,
            placeholder: x.placeholder,
            defaultValue: '',
            urlKey: `f.${x.registryKey}.between`,
          };
        })
        .filter((x): x is { id: string; label: string; type: 'number-range' | 'date-range'; placeholder: string; defaultValue: string; urlKey: string } => Boolean(x)),
    ],
    mobileCardSlot: (rows, opts) => {
      const cardRows = rows.map((row) => {
        const record = asRecord(row as Record<string, unknown>);
        return {
          id: String(record.id || record.policyId || ''),
          policyId: typeof record.policyId === 'string' ? record.policyId : undefined,
          policyNumber: typeof record.policyNumber === 'string' ? record.policyNumber : undefined,
          productType: typeof record.productType === 'string' ? record.productType : undefined,
          name: typeof record.name === 'string' ? record.name : undefined,
          insuredName: typeof record.insuredName === 'string' ? record.insuredName : undefined,
          status: typeof record.status === 'string' ? record.status : undefined,
          start: typeof record.start === 'string' ? record.start : undefined,
          end: typeof record.end === 'string' ? record.end : undefined,
          updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
          premium: typeof record.premium === 'number' ? record.premium : undefined,
          totalPremium: typeof record.totalPremium === 'number' ? record.totalPremium : undefined,
          currency: typeof record.currency === 'string' ? record.currency : undefined,
          quoteData: asRecord(record.quoteData),
        };
      });
      return React.createElement(PolicyCardList, { rows: cardRows, ...opts });
    },
  }) as RecordListConfig<PolicyListItem>;
}
