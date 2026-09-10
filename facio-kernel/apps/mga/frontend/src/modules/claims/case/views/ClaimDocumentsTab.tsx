import React, { useState } from 'react';
import type { Worksheet } from '../model/worksheetTypes';
import { normalizeFnolUploadItem } from '@/src/modules/claims/intake/views/clientFnol.helpers';
import { Button, Input, Modal, Select, Textarea, IconButton } from '@/src/shared/ui';
import { claimsApiClient } from '@/src/modules/claims/api/claimsApiClient';
import { documentsApiClient } from '@/src/modules/policies/api/documentsApiClient';

type EvidenceLabel =
  | 'Police report'
  | 'Repair estimate'
  | 'Garage report'
  | 'Invoice'
  | 'Photos'
  | 'Driver statement'
  | 'Witness statement'
  | 'Medical report'
  | 'Legal Document'
  | 'Other';

type EvidenceRow = {
  id: string;
  documentName: string;
  type: string;
  uploadedBy: string;
  uploadedAt: string;
  url: string;
};

const EVIDENCE_LABELS: EvidenceLabel[] = [
  'Police report',
  'Repair estimate',
  'Garage report',
  'Invoice',
  'Photos',
  'Driver statement',
  'Witness statement',
  'Medical report',
  'Legal Document',
  'Other',
];

const ACCEPTED_EVIDENCE_FILE_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt';
const BLOCKED_EVIDENCE_EXTENSIONS = new Set(['svg']);

function validateEvidenceFile(file: File | null): string {
  if (!file) return '';
  const ext = String(file.name || '').split('.').pop()?.trim().toLowerCase() || '';
  if (BLOCKED_EVIDENCE_EXTENSIONS.has(ext) || file.type === 'image/svg+xml') {
    return 'SVG files are not supported for evidence uploads. Please upload a PDF, photo, or document file.';
  }
  return '';
}

export function ClaimDocumentsTab({
  worksheet,
  onRefresh,
}: {
  worksheet: Worksheet;
  onRefresh?: () => Promise<unknown> | unknown;
}) {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [label, setLabel] = useState<EvidenceLabel>('Other');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [optimisticRows, setOptimisticRows] = useState<EvidenceRow[]>([]);

  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const asArray = <T = unknown,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  const readPath = (source: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((acc, segment) => asRecord(acc)[segment], source);
  const asText = (value: unknown): string => String(value || '').trim();
  const safeText = (value: unknown): string => {
    const raw = asText(value);
    return raw && raw !== '[object Object]' ? raw : '';
  };
  const toDateTimestamp = (value: unknown): number => {
    const dt = new Date(asText(value));
    return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
  };
  const extractFileName = (value: unknown): string => {
    const raw = safeText(value);
    if (!raw) return '';
    if (/^(https?:\/\/|\/|blob:|data:)/i.test(raw)) {
      const tail = raw.split('/').pop() || '';
      return safeText(tail);
    }
    return raw;
  };
  const stableUploadKey = (name: string, url: string): string => {
    const normalizedName = safeText(name).toLowerCase();
    const normalizedUrl = safeText(url).toLowerCase();
    return normalizedUrl || normalizedName;
  };
  const isTechnicalStorageName = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)?$/i.test(safeText(value));
  const formatDateTime = (value: unknown): string => {
    const raw = asText(value);
    if (!raw) return '';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(dt);
  };
  const asInlineViewHref = (href: string): string => {
    const v = safeText(href);
    if (!v) return '';
    if (v.includes('/api/documents/')) {
      return `${v}${v.includes('?') ? '&' : '?'}inline=1`;
    }
    return v;
  };

  // `spine/v2` Wave 5: canonical FNOL intake (`CanonicalIntakeSchema`)
  // has exactly one location for uploaded files —
  // `intake.evidence.{accidentLocation,vehicleDamage,policeReport,
  // drivingLicence,vehicleRegistrationCertificate}`. The pre-Wave-5 view
  // additionally read `payload.form` (the deleted parallel `finalForm`
  // shape), `uploads.*` (a deleted alias bucket), and the
  // `vehicleDamageDetails` / `policeReportDetails` synonyms — all
  // dropped in this commit. Worksheet timeline events use the same
  // canonical key set.
  const intakeFnol = asRecord(worksheet.intake?.fnol || {});
  const evidenceBuckets: Array<{ key: string; type: string }> = [
    { key: 'accidentLocation', type: 'Location of the Accident' },
    { key: 'vehicleDamage', type: 'Vehicle Damage Details' },
    { key: 'policeReport', type: 'Police Report Details' },
    { key: 'drivingLicence', type: 'Driving Licence' },
    { key: 'vehicleRegistrationCertificate', type: 'Vehicle Registration Certificate' },
  ];
  const uploadProvenance = new Map<string, { uploadedBy: string; uploadedAt: string }>();
  for (const event of asArray<Record<string, unknown>>(worksheet.timeline)) {
    const eventType = safeText(event.eventType).toUpperCase();
    if (!['FNOL_SUBMITTED', 'FNOL_AMENDED'].includes(eventType)) continue;
    const payload = asRecord(event.payload);
    const fnolPayload = asRecord(payload.fnol);
    for (const bucket of evidenceBuckets) {
      const values = asArray(readPath(fnolPayload, `evidence.${bucket.key}`));
      for (const value of values) {
        const normalized = normalizeFnolUploadItem(value);
        if (!normalized) continue;
        const name = extractFileName(normalized.name || normalized.filename || normalized.url);
        const key = stableUploadKey(name, safeText(normalized.url));
        if (!key || uploadProvenance.has(key)) continue;
        uploadProvenance.set(key, {
          uploadedBy: safeText(event.actorName),
          uploadedAt: safeText(event.occurredAt),
        });
      }
    }
  }

  const fallbackUploadedBy = safeText(
    worksheet.intake?.submittedBy?.actorName
    || worksheet.intake?.amendments?.[worksheet.intake.amendments.length - 1]?.amendedBy?.actorName,
  ) || '-';
  const fallbackUploadedAt = safeText(
    worksheet.intake?.submittedAt
    || worksheet.intake?.amendments?.[worksheet.intake.amendments.length - 1]?.amendedAt,
  );
  const intakeRows = evidenceBuckets.flatMap((bucket) => {
    const values = asArray(readPath(intakeFnol, `evidence.${bucket.key}`));
    return values
      .map((entry, idx): EvidenceRow | null => {
        const normalized = normalizeFnolUploadItem(entry);
        if (!normalized) return null;
        const rec = asRecord(entry);
        const url = safeText(normalized.url || rec.url || rec.href || rec.storageUri);
        const name = extractFileName(
          rec.name
          || rec.originalName
          || rec.filename
          || normalized.name
          || normalized.filename
          || url,
        ) || `Document ${idx + 1}`;
        const key = stableUploadKey(name, url);
        const provenance = uploadProvenance.get(key);
        return {
          id: `intake-${bucket.key}-${idx}-${key || name}`,
          documentName: name,
          type: bucket.type,
          uploadedBy: provenance?.uploadedBy || fallbackUploadedBy,
          uploadedAt: provenance?.uploadedAt || safeText(rec.createdAt || rec.uploadedAt || rec.timestamp) || fallbackUploadedAt,
          url,
        };
      })
      .filter((doc): doc is EvidenceRow => Boolean(doc));
  });
  const preferredNameByUrl = new Map<string, string>();
  for (const row of intakeRows) {
    if (!row.url || !row.documentName || isTechnicalStorageName(row.documentName)) continue;
    preferredNameByUrl.set(row.url, row.documentName);
  }
  const baseDocs = Array.isArray(worksheet.documents) ? worksheet.documents : [];
  const baseDocsNormalized = baseDocs.map((doc, idx): EvidenceRow => {
    const rec = asRecord(doc);
    const normalized = normalizeFnolUploadItem(rec);
    const url = safeText(normalized?.url || rec.url || rec.storageUri || rec.publicUrl);
    const preferredByUrl = url ? preferredNameByUrl.get(url) : '';
    const candidateName = extractFileName(
      rec.originalName
      || rec.uploadOriginalName
      || rec.uploadName
      || rec.name
      || rec.filename
      || normalized?.name
      || normalized?.filename
      || url,
    ) || '';
    const rawName = (!isTechnicalStorageName(candidateName) ? candidateName : '') || preferredByUrl || `Document ${idx + 1}`;
    const docType = safeText(rec.label || rec.type || rec.category || rec.documentType) || 'Other';
    const uploadedBy = safeText(rec.uploadedByName || rec.uploadedBy || rec.actorName || rec.createdByName);
    return {
      id: safeText(rec.id) || `base-${idx}-${url || rawName}`,
      documentName: rawName,
      type: docType,
      uploadedBy: uploadedBy || '-',
      url,
      uploadedAt: safeText(rec.createdAt || rec.uploadedAt || rec.timestamp),
    };
  });
  const seen = new Set<string>();
  const urlByName = new Map<string, string>();
  for (const doc of baseDocsNormalized) {
    const key = String(doc.documentName || '').trim().toLowerCase();
    if (key && doc.url) urlByName.set(key, doc.url);
  }
  const docs = [...baseDocsNormalized, ...intakeRows, ...optimisticRows].filter((doc) => {
    if (!doc.url) {
      const fallbackUrl = urlByName.get(String(doc.documentName || '').trim().toLowerCase());
      if (fallbackUrl) doc.url = fallbackUrl;
    }
    const key = `${doc.url}|${doc.documentName}|${doc.type}|${doc.uploadedBy}|${doc.uploadedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sortedDocs = [...docs].sort((a, b) => toDateTimestamp(b.uploadedAt) - toDateTimestamp(a.uploadedAt));

  const resetUploadForm = () => {
    setLabel('Other');
    setDescription('');
    setFile(null);
    setUploadError('');
  };

  const handleUploadEvidence = async () => {
    if (!file || !label) {
      setUploadError('Document label and file are required.');
      return;
    }
    const fileValidationError = validateEvidenceFile(file);
    if (fileValidationError) {
      setUploadError(fileValidationError);
      return;
    }
    if (!worksheet.claimId) {
      setUploadError('Claim id is missing for this case.');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const uploadRes = await documentsApiClient.uploadDocument(file);
      if (!uploadRes.success || !uploadRes.data) {
        throw new Error(uploadRes.error?.message || 'Upload failed');
      }
      const uploadRecord = asRecord(uploadRes.data);
      const uploadedUrl = safeText(uploadRecord.url);
      const uploadedFilename = safeText(uploadRecord.filename || uploadRecord.name || file.name);
      const uploadedDocumentId = safeText(uploadRecord.id || uploadRecord.documentId);
      const payload: Record<string, unknown> = {
        summary: `Evidence added - ${label} uploaded`,
        label,
        description: safeText(description),
        source: 'handler',
        filename: uploadedFilename,
        url: uploadedUrl,
        evidence: {
          label,
          description: safeText(description),
          source: 'handler',
          filename: uploadedFilename,
          url: uploadedUrl,
          uploadedAt: new Date().toISOString(),
        },
      };
      await claimsApiClient.createClaimDevelopment(worksheet.claimId, {
        type: 'NOTE',
        payload,
        attachments: uploadedDocumentId ? [uploadedDocumentId] : (uploadedFilename ? [uploadedFilename] : []),
      });
      setOptimisticRows((prev) => [
        {
          id: `optimistic-${Date.now()}-${file.name}`,
          documentName: file.name,
          type: label,
          uploadedBy: safeText(worksheet.topBar?.lastActorName) || '-',
          uploadedAt: new Date().toISOString(),
          url: uploadedUrl,
        },
        ...prev,
      ]);
      await onRefresh?.();
      resetUploadForm();
      setShowUploadModal(false);
    } catch (error) {
      setUploadError((error as Error).message || 'Failed to upload evidence');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="space-y-4">
      {sortedDocs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-5 py-8">
          <div className="text-sm font-semibold text-slate-700">No documents uploaded yet.</div>
          <div className="mt-1 text-sm text-slate-500">
            Upload evidence such as photos, police reports or repair estimates.
          </div>
        </div>
      ) : (
        <div className="ui-table-wrap">
          <div className="overflow-auto">
            <table className="ui-table min-w-full">
              <thead className="ui-thead">
                <tr>
                  <th className="px-10 py-5 text-[10px]">Document name</th>
                  <th className="px-10 py-5 text-[10px]">Type</th>
                  <th className="px-10 py-5 text-[10px]">Uploaded by</th>
                  <th className="px-10 py-5 text-[10px]">Date added</th>
                  <th className="px-10 py-5 text-right text-[10px]">Actions</th>
                </tr>
              </thead>
              <tbody className="ui-tbody text-xs">
                {sortedDocs.map((doc) => {
                  const uploadedAt = formatDateTime(doc.uploadedAt) || '-';
                  return (
                    <tr key={doc.id} className="ui-row bg-white/0">
                      <td className="px-10 py-5 font-bold text-slate-900">{doc.documentName || '-'}</td>
                      <td className="px-10 py-5 text-slate-700 font-semibold">{doc.type || '-'}</td>
                      <td className="px-10 py-5 text-slate-700 font-semibold">{doc.uploadedBy || '-'}</td>
                      <td className="px-10 py-5 text-slate-700 font-semibold">{uploadedAt}</td>
                      <td className="px-10 py-5">
                        <div className="flex items-center justify-end gap-3">
                          {doc.url ? (
                            <>
                              <IconButton
                                title={`Download ${doc.documentName}`}
                                variant="neutral"
                                className="w-10 h-10 rounded-2xl"
                                onClick={() => window.open(doc.url, '_blank', 'noopener,noreferrer')}
                              >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v10m0 0l4-4m-4 4l-4-4" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v3h16v-3" />
                                </svg>
                              </IconButton>
                              <a
                                href={asInlineViewHref(doc.url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-black uppercase tracking-widest text-brand-primary hover:underline"
                              >
                                View
                              </a>
                            </>
                          ) : (
                            <span className="text-xs font-semibold text-slate-400">Not available</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={showUploadModal}
        onClose={() => {
          if (uploading) return;
          setShowUploadModal(false);
          resetUploadForm();
        }}
        title="Add Evidence"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-600">Document label</label>
            <Select variant="ui" value={label} onChange={(e) => setLabel(e.target.value as EvidenceLabel)}>
              {EVIDENCE_LABELS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-600">Description (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Estimate from BMW garage"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-600">Upload file</label>
            <Input
              variant="ui"
              type="file"
              accept={ACCEPTED_EVIDENCE_FILE_TYPES}
              onChange={(e) => {
                const selected = e.target.files?.[0] || null;
                const validationError = validateEvidenceFile(selected);
                setFile(validationError ? null : selected);
                setUploadError(validationError);
                if (validationError) e.currentTarget.value = '';
              }}
            />
          </div>
          {uploadError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {uploadError}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button onClick={() => void handleUploadEvidence()} isLoading={uploading}>
              Upload document
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

