import { http } from '@/src/shared/api/http';

type RatingMatrixLike = {
  source: string;
  sheet: string;
  baseMatrix: { xKey: string; yKey: string; x: number[]; y: string[]; values: number[][]; note: string };
  factors: {
    driverBasis: Array<{ label: string; factor: number }>;
    proposerAge: Array<{ label: string; factor: number }>;
    vehicleAge: Array<{ label: string; factor: number }>;
    licencePeriod: Array<{ label: string; factor: number }>;
    addedDriversUnder25: Array<{ label: string; factor: number }>;
  };
  lloyds?: {
    standardsRef: 'CRS_V5_2';
    sourceDocUrl?: string;
    mappings: Array<{
      crCode: string;
      title: string;
      pvrKey: string;
      transform?: string;
      notes?: string;
      required?: boolean;
    }>;
  };
};

type PricingStageLike = {
  id: string;
  name: string;
  kind: 'table_lookup' | 'factor' | 'fee' | 'custom';
  tableKey?: keyof RatingMatrixLike['factors'] | 'baseMatrix';
  notes?: string;
};

type PersistedRatingModelLike = {
  id: string;
  programId: string;
  version: number;
  status: string;
  source?: string | null;
  tables: RatingMatrixLike;
  stages: PricingStageLike[];
  createdAt: string;
  updatedAt: string;
};

export type PolicyOperationalReportRow = {
  policyId: string;
  policyNumber: string;
  insuredName: string;
  productType: string | null;
  status: string;
  boStatus: string | null;
  operatingTenantId: string;
  date: string | null;
  totalPremium: number;
  outstandingBalance: number;
  invoiceOverdue: boolean;
};

export type AuditOperationalReportRow = {
  id: string;
  occurredAt: string;
  actorId: string;
  actorName: string | null;
  actorType: string;
  actionName: string;
  entityType: string;
  entityId: string;
  changed: boolean;
  result: string | null;
};

export type ReportFilterEcho = {
  start: string | null;
  end: string | null;
  dateBasis: 'createdAt' | 'inceptionDate' | 'issuedAt';
  programId: string | null;
  productType: string | null;
  operatingTenantId: string | null;
};

export type AuditReportFilterEcho = {
  start: string | null;
  end: string | null;
  actorId: string | null;
  entityType: string | null;
  actionPrefix: string | null;
  changedOnly: boolean;
  viewOnly: boolean;
};

export type PolicyOperationalReport = {
  filters: ReportFilterEcho;
  totals: {
    count: number;
    totalPremium: number;
    outstandingBalance: number;
    invoiceOverdueCount: number;
  };
  items: PolicyOperationalReportRow[];
};

export type AuditOperationalReport = {
  filters: AuditReportFilterEcho;
  totals: { count: number };
  items: AuditOperationalReportRow[];
};

export type PolicyOperationalReportFilters = {
  start?: string;
  end?: string;
  dateBasis?: 'createdAt' | 'inceptionDate' | 'issuedAt';
  programId?: string;
  productType?: string;
  operatingTenantId?: string;
  limit?: number;
};

export type OfficeTargetBundleInput = {
  productCode?: string;
  periodStart: string;
  periodEnd: string;
  newBusiness: {
    premiumTarget: number;
    policyCountTarget: number;
  };
  renewal: {
    premiumTarget: number;
    policyCountTarget: number;
  };
};

export type OfficeTargetInput = {
  scope: 'OFFICE' | 'STAFF';
  businessCategory?: 'NEW_BUSINESS' | 'RENEWAL';
  userId?: string;
  productCode?: string;
  periodStart: string;
  periodEnd: string;
  premiumTarget: number;
  policyCountTarget: number;
  conversionTarget?: number;
};

export type OfficeTargetCategoryRow = {
  category: 'NEW_BUSINESS' | 'RENEWAL' | 'TOTAL';
  label: string;
  premiumTarget: number;
  policyCountTarget: number;
  premiumActual: number;
  policyCountActual: number;
  premiumVariance: number;
  policyCountVariance: number;
};

export type OfficeTargetReportGroup = {
  productCode: string | null;
  periodStart: string;
  periodEnd: string;
  categories: OfficeTargetCategoryRow[];
};

export type OfficeTargetReport = {
  filters: ReportFilterEcho;
  actuals: {
    premium: number;
    policyCount: number;
    newBusinessPremium: number;
    renewalPremium: number;
    newBusinessPolicyCount: number;
    renewalPolicyCount: number;
  };
  groups: OfficeTargetReportGroup[];
};

export type OriginConversionReportRow = {
  [key: string]: OperationalReportCell;
  staffUserId: string;
  origin: string;
  enquiries: number;
  converted: number;
  premium: number;
  conversionRate: number;
};

export type CyprusDemographicReportRow = {
  [key: string]: OperationalReportCell;
  ageBand: string;
  policies: number;
  premium: number;
};

export type DnoReportRow = {
  [key: string]: OperationalReportCell;
  policyId: string;
  policyNumber: string;
  insuredName: string;
  productType: string | null;
  status: string;
  origin: string;
  totalPremium: number;
  updatedAt: string;
};

export type OperationalReportCell = string | number | boolean | null | undefined;
export type GenericOperationalReportRow = {
  [key: string]: OperationalReportCell;
};

export type GenericOperationalReport = {
  filters?: ReportFilterEcho;
  items?: GenericOperationalReportRow[];
  groups?: OfficeTargetReportGroup[];
  actuals?: {
    [key: string]: OperationalReportCell;
  };
};

export type PersonnelFilePayload = {
  id?: string;
  userId?: string;
  staffNumber?: string | null;
  jobTitle?: string | null;
  office?: string | null;
  phone?: string | null;
  notes?: string | null;
  payslips?: StaffPayslipPayload[];
};

export type PersonnelFileInput = {
  staffNumber?: string;
  jobTitle?: string;
  office?: string;
  phone?: string;
  notes?: string;
};

export type StaffAbsenceInput = {
  userId: string;
  absenceType: string;
  startDate: string;
  endDate: string;
  notes?: string;
};

export type StaffAbsencePayload = StaffAbsenceInput & {
  id: string;
  status?: string;
  createdByUserId?: string | null;
};

export type WhoIsInPayload = {
  absent: StaffAbsencePayload[];
};

export type StaffPayslipInput = {
  userId: string;
  periodLabel: string;
  fileName: string;
  storageKey?: string;
};

export type StaffPayslipPayload = {
  id: string;
  personnelFileId: string;
  periodLabel: string;
  fileName: string;
  storageKey: string | null;
  uploadedByUserId: string | null;
  uploadedAt?: string;
};

export type StaffDiaryInput = {
  ownerUserId: string;
  title: string;
  body?: string;
  startAt: string;
  endAt?: string;
  visibility?: 'PRIVATE' | 'STAFF' | 'MANAGEMENT';
};

export type StaffDiaryEntry = StaffDiaryInput & {
  id: string;
  body: string | null;
  endAt: string | null;
  visibility: 'PRIVATE' | 'STAFF' | 'MANAGEMENT';
  createdByUserId: string;
  ownerName?: string;
};

export type StaffDirectoryPerson = {
  id: string;
  name: string;
  email: string;
};

export type StaffMessageInput = {
  toUserIds: string[];
  subject: string;
  body: string;
};

export type StaffMessage = StaffMessageInput & {
  id: string;
  fromUserId: string;
  archivedByUserIds?: string[];
  createdAt?: string;
};

export type MotorMarketProvider = 'SEGURNET' | 'FIVA';
export type MotorMarketChannel = 'SEGURNET_FNM' | 'E_SEGURNET' | 'IDS_CIDS' | 'FIVA';
export type MotorMarketSubmissionStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RETRYABLE_FAILURE'
  | 'TERMINAL_FAILURE'
  | 'BLOCKED_WAITING_FOR_EXTERNAL_SPEC';

export type MotorMarketChecklist = {
  status: MotorMarketSubmissionStatus;
  items: Array<{ label: string; received: boolean }>;
};

export type MotorMarketSubmissionAttempt = {
  id: string;
  attemptNumber: number;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  attemptedAt: string;
};

export type MotorMarketSubmission = {
  id: string;
  provider: string;
  channel: string;
  status: string;
  policyId: string | null;
  claimId: string | null;
  riskTransactionId: string | null;
  externalReference: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  updatedAt: string;
  attempts?: MotorMarketSubmissionAttempt[];
};

export type MotorMarketReconciliation = {
  statuses: Array<{ status: MotorMarketSubmissionStatus; count: number }>;
};

export type AuditOperationalReportFilters = {
  start?: string;
  end?: string;
  actorId?: string;
  entityType?: string;
  actionPrefix?: string;
  changedOnly?: boolean;
  limit?: number;
};

type ReportParamValue = string | number | boolean | null | undefined;
type ReportParamInput = {
  [key: string]: ReportParamValue;
};

function reportParams(filters?: ReportParamInput): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === null || value === undefined || value === '') continue;
    params.append(key, String(value));
  }
  return params;
}

export const boApiClient = {
  // Transport — kernel
  request: <T>(path: string, init?: RequestInit) => http.request<T>(path, init),
  // Policies — domain client
  listPolicies: async (filters?: {
    status?: string;
    statusIn?: string[];
    needsAttention?: boolean;
    q?: string;
    projection?: string;
    productType?: string;
    page?: number;
    pageSize?: number;
    paging?: 'cursor';
    cursor?: string | null;
    limit?: number;
    includeTotal?: boolean;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    sortField2?: string;
    sortDir2?: 'asc' | 'desc';
    sortField3?: string;
    sortDir3?: 'asc' | 'desc';
    viewId?: string;
    filterOps?: Record<string, string>;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.statusIn?.length) params.append('statusIn', filters.statusIn.join(','));
    if (typeof filters?.needsAttention === 'boolean' && filters.needsAttention) params.append('needsAttention', '1');
    if (filters?.q) params.append('q', filters.q);
    if (filters?.projection) params.append('projection', filters.projection);
    if (filters?.productType) params.append('productType', filters.productType);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.pageSize) params.append('pageSize', filters.pageSize.toString());
    if (filters?.paging === 'cursor') params.append('paging', 'cursor');
    if (filters?.cursor) params.append('cursor', String(filters.cursor));
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.includeTotal) params.append('includeTotal', '1');
    if (filters?.sortField) params.append('sortField', String(filters.sortField));
    if (filters?.sortDir) params.append('sortDir', String(filters.sortDir));
    if (filters?.sortField2) params.append('sortField2', String(filters.sortField2));
    if (filters?.sortDir2) params.append('sortDir2', String(filters.sortDir2));
    if (filters?.sortField3) params.append('sortField3', String(filters.sortField3));
    if (filters?.sortDir3) params.append('sortDir3', String(filters.sortDir3));
    if (filters?.viewId) params.append('viewId', String(filters.viewId));
    if (filters?.filterOps && typeof filters.filterOps === 'object') {
      for (const [k, v] of Object.entries(filters.filterOps)) {
        if (!k) continue;
        const value = String(v || '').trim();
        if (!value) continue;
        params.append(k, value);
      }
    }
    return http.request(`policies?${params.toString()}`);
  },
  // Programs & Binders — domain client
  listBinders: () => http.request('binders'),
  uploadBinder: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return http.request('binders/upload', { method: 'POST', body: formData });
  },
  getBinder: (id: string) => http.request(`binders/${id}`),
  updateBinder: <T extends object>(id: string, data: T) =>
    http.request(`binders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  createBinder: <T extends object>(data: T) =>
    http.request('binders', { method: 'POST', body: JSON.stringify(data) }),
  getBinderUsage: (id: string) => http.request(`binders/${id}/usage`),
  publishBinder: (id: string) => http.request(`binders/${id}/publish`, { method: 'POST' }),
  simulateBinderCheck: (
    id: string,
    data: {
      territory?: string;
      riskLocationCountry?: string;
      insuredDomicileCountry?: string;
      vehicleValue?: number;
    }
  ) =>
    http.request(`binders/${id}/simulate-check`, { method: 'POST', body: JSON.stringify(data) }),
  listPrograms: () => http.request('programs'),
  updateProgram: (id: string, data: Record<string, unknown>) => http.request(`programs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  createProgram: (data: Record<string, unknown>) => http.request('programs', { method: 'POST', body: JSON.stringify(data) }),
  getProgramRatingModel: (id: string) => http.request<PersistedRatingModelLike>(`programs/${id}/rating-model`),
  getProgramRatingMatrix: (id: string) => http.request<RatingMatrixLike>(`programs/${id}/rating-matrix`),
  saveProgramRatingModel: (id: string, data: Record<string, unknown>) =>
    http.request<PersistedRatingModelLike>(`programs/${id}/rating-model`, { method: 'PUT', body: JSON.stringify(data) }),
  publishProgramRatingModel: (id: string) => http.request<PersistedRatingModelLike>(`programs/${id}/rating-model/publish`, { method: 'POST' }),
  getProgramUwConfig: (id: string) => http.request(`programs/${id}/uw-config`),
  saveProgramUwConfig: (id: string, data: Record<string, unknown>) => http.request(`programs/${id}/uw-config`, { method: 'PUT', body: JSON.stringify(data) }),
  // Invoices — domain client
  listInvoices: (filters?: { status?: string; page?: number; pageSize?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.pageSize) params.append('pageSize', filters.pageSize.toString());
    return http.request(`invoices?${params.toString()}`);
  },
  // Users — domain client
  listUsers: () => http.request<Record<string, unknown>[]>('users'),
  inviteUser: (data: { email: string; name?: string; role: string; team?: string }) =>
    http.request('users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: { name?: string; email?: string; phone?: string; role?: 'ADMIN' | 'UNDERWRITER' | 'CUSTOMER'; team?: string }) =>
    http.request(`users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  updateUserStatus: (id: string, isActive: boolean) =>
    http.request(`users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  deleteUser: (userId: string) => http.request(`users/${userId}`, { method: 'DELETE' }),
  adminResetPassword: (id: string) => http.request(`users/${id}/reset-password`, { method: 'POST' }),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    http.request('auth/change-password', { method: 'POST', body: JSON.stringify(data) }),
  getMyPersonnelFile: () => http.request<PersonnelFilePayload | null>('people/me/personnel-file'),
  saveMyPersonnelFile: (data: PersonnelFileInput) =>
    http.request('people/me/personnel-file', { method: 'PUT', body: JSON.stringify(data) }),
  getStaffPersonnelFile: (userId: string) => http.request<PersonnelFilePayload | null>(`people/staff/${encodeURIComponent(userId)}/personnel-file`),
  saveStaffPersonnelFile: (userId: string, data: PersonnelFileInput) =>
    http.request<PersonnelFilePayload>(`people/staff/${encodeURIComponent(userId)}/personnel-file`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  createStaffAbsence: (data: StaffAbsenceInput) =>
    http.request('people/absences', { method: 'POST', body: JSON.stringify(data) }),
  cancelStaffAbsence: (id: string) =>
    http.request<StaffAbsencePayload>(`people/absences/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' }),
  listStaffAbsences: (args?: { from?: string; to?: string; offset?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (args?.from) params.set('from', args.from);
    if (args?.to) params.set('to', args.to);
    if (args?.offset !== undefined) params.set('offset', String(args.offset));
    if (args?.limit !== undefined) params.set('limit', String(args.limit));
    const query = params.toString();
    return http.request<StaffAbsencePayload[]>(`people/absences${query ? `?${query}` : ''}`);
  },
  listStaffDirectory: (args?: { search?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (args?.search) params.set('search', args.search);
    if (args?.limit !== undefined) params.set('limit', String(args.limit));
    const query = params.toString();
    return http.request<StaffDirectoryPerson[]>(`people/staff-directory${query ? `?${query}` : ''}`);
  },
  getWhoIsIn: () => http.request<WhoIsInPayload>('people/who-is-in'),
  uploadPayslipRecord: (data: StaffPayslipInput) =>
    http.request('people/payslips', { method: 'POST', body: JSON.stringify(data) }),
  uploadPayslipFile: (data: { userId: string; periodLabel: string; file: File }) => {
    const formData = new FormData();
    formData.append('userId', data.userId);
    formData.append('periodLabel', data.periodLabel);
    formData.append('file', data.file);
    return http.request<StaffPayslipPayload>('people/payslips/upload', { method: 'POST', body: formData });
  },
  createDiaryEntry: (data: StaffDiaryInput) =>
    http.request('people/diary', { method: 'POST', body: JSON.stringify(data) }),
  listDiaryEntries: (ownerUserId?: string) => {
    const params = new URLSearchParams();
    if (ownerUserId) params.set('ownerUserId', ownerUserId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return http.request<StaffDiaryEntry[]>(`people/diary${suffix}`);
  },
  sendStaffMessage: (data: StaffMessageInput) =>
    http.request('people/messages', { method: 'POST', body: JSON.stringify(data) }),
  listStaffMessages: () => http.request<StaffMessage[]>('people/messages'),
  listArchivedStaffMessages: () => http.request<StaffMessage[]>('people/messages/archive'),
  // Accounts — domain client
  getAccount: (id: string) => http.request(`accounts/${id}`),
  updateAccount: (id: string, data: Record<string, unknown>) => http.request(`accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  createAccount: (data: Record<string, unknown>) => http.request('accounts', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccount: (id: string) => http.request(`accounts/${id}`, { method: 'DELETE' }),
  // Settings & Reporting — domain client
  getSettings: (key: string) => http.request<unknown>(`settings/${key}`),
  saveSettings: (key: string, value: unknown) => http.request(`settings/${key}`, { method: 'POST', body: JSON.stringify(value) }),
  /**
   * Lloyd's monthly reporting lane (user-operated):
   * downloads the CRS v5.2 file from /bordereaux/v5.2/:stream.
   */
  downloadLloydsBdxV52Export: async (params: {
    stream: 'risk' | 'premium' | 'claims';
    binderId: string;
    productType: string;
    year: number;
    month: number;
    format?: 'csv' | 'xlsx';
    validate?: boolean;
    includeZeroFinancialRows?: boolean;
  }) => {
    const query = new URLSearchParams({
      binderId: params.binderId,
      productType: params.productType,
      year: String(params.year),
      month: String(params.month),
      format: params.format || 'xlsx',
    });
    if (params.validate) query.set('validate', 'true');
    if (typeof params.includeZeroFinancialRows === 'boolean') query.set('includeZeroFinancialRows', String(params.includeZeroFinancialRows));
    const response = await http.requestBinary(`bordereaux/v5.2/${params.stream}?${query.toString()}`);
    const contentDisposition = response.headers.get('content-disposition') || '';
    const filenameMatch = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(contentDisposition);
    const suggestedFilename = decodeURIComponent((filenameMatch?.[1] || '').replace(/"/g, '').trim());
    const blob = await response.blob();
    return {
      blob,
      filename: suggestedFilename || `lloyds_v5.2_${params.stream}_${params.year}-${String(params.month).padStart(2, '0')}.${params.format || 'xlsx'}`,
      contentType: response.headers.get('content-type') || blob.type,
      exportHash: response.headers.get('x-bdx-export-hash') || '',
      zeroRowsSuppressed: Number(response.headers.get('x-bdx-zerorows-suppressed') || '0') || 0,
    };
  },
  previewLloydsBdxV52Export: (params: {
    stream: 'risk' | 'premium' | 'claims';
    binderId: string;
    productType: string;
    year: number;
    month: number;
  }) => {
    const query = new URLSearchParams({
      binderId: params.binderId,
      productType: params.productType,
      year: String(params.year),
      month: String(params.month),
    });
    return http.request<Record<string, unknown>>(`bordereaux/v5.2/${params.stream}/preview?${query.toString()}`);
  },
  getDashboard: (period?: { start?: string; end?: string; mode?: 'MTD' | 'FULL'; programId?: string }) => {
    const params = new URLSearchParams();
    if (period?.start) params.append('period.start', period.start);
    if (period?.end) params.append('period.end', period.end);
    if (period?.mode) params.append('mode', period.mode);
    if (period?.programId) params.append('programId', period.programId);
    params.append('dateBasis', 'inceptionDate');
    return http.request<Record<string, unknown>>(`reports/dashboard?${params.toString()}`);
  },
  getCashSheet: (filters?: PolicyOperationalReportFilters) =>
    http.request<PolicyOperationalReport>(`reports/cash-sheet?${reportParams(filters).toString()}`),
  downloadCashSheetCsv: async (filters?: PolicyOperationalReportFilters) => {
    const response = await http.requestBinary(`reports/cash-sheet.csv?${reportParams(filters).toString()}`);
    const contentDisposition = response.headers.get('content-disposition') || '';
    const filenameMatch = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(contentDisposition);
    const suggestedFilename = decodeURIComponent((filenameMatch?.[1] || '').replace(/"/g, '').trim());
    return {
      blob: await response.blob(),
      filename: suggestedFilename || 'cash-sheet.csv',
      contentType: response.headers.get('content-type') || 'text/csv',
    };
  },
  getDebtorsReport: (filters?: PolicyOperationalReportFilters) =>
    http.request<PolicyOperationalReport>(`reports/debtors?${reportParams(filters).toString()}`),
  getActivityLogReport: (filters?: AuditOperationalReportFilters) =>
    http.request<AuditOperationalReport>(`reports/activity-log?${reportParams(filters).toString()}`),
  getViewTracksReport: (filters?: AuditOperationalReportFilters) =>
    http.request<AuditOperationalReport>(`reports/view-tracks?${reportParams(filters).toString()}`),
  getOfficeTargetReport: (filters?: PolicyOperationalReportFilters) =>
    http.request<OfficeTargetReport>(`reports/office-targets?${reportParams(filters).toString()}`),
  saveOfficeTarget: (data: OfficeTargetInput | OfficeTargetBundleInput) =>
    http.request('reports/office-targets', { method: 'POST', body: JSON.stringify(data) }),
  assignPolicyToStaff: (data: { policyId: string; assignedToUserId: string }) =>
    http.request('reports/allocator/assign', { method: 'POST', body: JSON.stringify(data) }),
  getOriginConversionReport: (filters?: PolicyOperationalReportFilters) =>
    http.request<GenericOperationalReport & { items: OriginConversionReportRow[] }>(`reports/origin-conversion?${reportParams(filters).toString()}`),
  getCyprusDemographicReport: (filters?: PolicyOperationalReportFilters) =>
    http.request<GenericOperationalReport & { items: CyprusDemographicReportRow[] }>(`reports/cyprus-demographic?${reportParams(filters).toString()}`),
  getDnoReport: (filters?: PolicyOperationalReportFilters) =>
    http.request<GenericOperationalReport & { items: DnoReportRow[] }>(`reports/dno?${reportParams(filters).toString()}`),
  getMotorMarketChecklist: () =>
    http.request<MotorMarketChecklist>('motor-market-integrations/checklist'),
  listMotorMarketSubmissions: (filters?: {
    provider?: MotorMarketProvider;
    channel?: MotorMarketChannel;
    status?: MotorMarketSubmissionStatus;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.provider) params.append('provider', filters.provider);
    if (filters?.channel) params.append('channel', filters.channel);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', String(filters.limit));
    return http.request<{ items: MotorMarketSubmission[] }>(`motor-market-integrations/submissions?${params.toString()}`);
  },
  getMotorMarketReconciliation: () =>
    http.request<MotorMarketReconciliation>('motor-market-integrations/reconciliation'),
  prepareSegurnetPolicySubmission: (policyId: string, data?: { riskTransactionId?: string }) =>
    http.request('motor-market-integrations/policies/' + encodeURIComponent(policyId) + '/segurnet-fnm', { method: 'POST', body: JSON.stringify(data || {}) }),
  prepareESegurnetClaimSubmission: (claimId: string) =>
    http.request('motor-market-integrations/claims/' + encodeURIComponent(claimId) + '/e-segurnet-fnol', { method: 'POST' }),
  prepareIdsCidsClaimSubmission: (claimId: string) =>
    http.request('motor-market-integrations/claims/' + encodeURIComponent(claimId) + '/ids-cids', { method: 'POST' }),
  retryMotorMarketSubmission: (submissionId: string) =>
    http.request('motor-market-integrations/submissions/' + encodeURIComponent(submissionId) + '/retry', { method: 'POST' }),
  getPolicyCounts: (filters?: {
    start?: string;
    end?: string;
    dateBasis?: 'createdAt' | 'inceptionDate' | 'issuedAt';
    programId?: string;
    binderId?: string;
    productType?: string;
    statusIn?: string[];
    bdxOnly?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (filters?.start) params.append('start', filters.start);
    if (filters?.end) params.append('end', filters.end);
    if (filters?.dateBasis) params.append('dateBasis', filters.dateBasis);
    if (filters?.programId) params.append('programId', filters.programId);
    if (filters?.binderId) params.append('binderId', filters.binderId);
    if (filters?.productType) params.append('productType', filters.productType);
    if (filters?.statusIn?.length) params.append('statusIn', filters.statusIn.join(','));
    if (typeof filters?.bdxOnly === 'boolean') params.append('bdxOnly', String(filters.bdxOnly));
    return http.request<Record<string, unknown>>(`policies/counts?${params.toString()}`);
  },
  getBdxMigrationStatus: (filters?: { runId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.runId) params.append('runId', filters.runId);
    return http.request<Record<string, unknown>>(`policies/migration-status/bdx?${params.toString()}`);
  },
  getGlobalSettings: () => http.request<Record<string, unknown>>('settings/global_commissions'),
  getTemplateSettings: () => http.request<Record<string, unknown>>('settings/templates'),
  getEmailTemplateSettings: () => http.request('settings/email_templates'),
  uploadTemplate: (file: File, type: 'quote' | 'certificate' | 'invoice' | 'bordereaux') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    return http.request<Record<string, unknown>>('settings/templates/upload', { method: 'POST', body: formData });
  },
  updateGlobalSettings: (settings: Record<string, unknown>) =>
    http.request('settings/global_commissions', { method: 'POST', body: JSON.stringify(settings) }),
  updateTemplateSettings: (settings: Record<string, unknown>) =>
    http.request('settings/templates', { method: 'POST', body: JSON.stringify(settings) }),
  updateEmailTemplateSettings: (data: { sendgridAutoQuoteInitialTemplateId?: string; sendgridAutoQuoteResendTemplateId?: string }) =>
    http.request('settings/email_templates', { method: 'POST', body: JSON.stringify(data) }),
};

export type BoApiClient = typeof boApiClient;
