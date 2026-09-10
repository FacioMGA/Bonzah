import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DocumentRequest, DocumentPack } from '../contracts/documents.js';
import { MAX_DOCUMENT_BYTES } from '../contracts/documents.js';
import { KernelError } from './canonical.js';
import { configuredSubmissionV2Schema } from '../contracts/insurance-definition.js';

type Template = DocumentPack['templates'][number];
type Section = { title: string; rows: [string, string][] };
export type RenderedDocument = {
  templateId: string;
  templateVersion: string;
  format: 'pdf' | 'html';
  bytes: Uint8Array;
};
const title = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (minor: string, currency: string) => {
  const digits = currency === 'JPY' ? 0 : currency === 'KWD' ? 3 : 2;
  const negative = minor.startsWith('-');
  const value = minor.replace(/^-/, '').padStart(digits + 1, '0');
  return `${currency} ${negative ? '-' : ''}${(digits ? value.slice(0, -digits) : value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${digits ? '.' + value.slice(-digits) : ''}`;
};
const documentNumber = (request: DocumentRequest, template: Template) =>
  `${request.documentNumber}-${template.id}`;
const percent = (basisPoints: number) =>
  `${Math.trunc(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}%`;
export function documentSections(request: DocumentRequest, template: Template): Section[] {
  const { record, event, definition } = request.snapshot;
  const submission = record.configuredService?.submission ?? record.decision?.submission;
  const parsedV2 = configuredSubmissionV2Schema.safeParse(submission);
  const submissionV2 = parsedV2.success ? parsedV2.data : null;
  const sections: Section[] = [
    {
      title: 'Retained transaction',
      rows: [
        ['Document number', documentNumber(request, template)],
        ['Document version', String(request.recordVersion)],
        ['Transaction', `${title(event.type)} / revision ${record.version}`],
        ['Record status', title(record.status)],
        ['Policy record', record.id],
        ['Product', `${record.productId} / ${record.productVersion}`],
        ['Risk description', submission?.summary ?? record.quote.risk.summary],
        [
          submission ? 'Source submission' : 'Source quote',
          submission
            ? `${submission.reference} / ${submission.version}`
            : `${record.quote.sourceQuote.reference} / ${record.quote.sourceQuote.version}`,
        ],
        ['Term start', (submission?.term ?? record.quote.term).startDate],
        ['Term end', (submission?.term ?? record.quote.term).endDate],
        ['Transaction effective date', event.effectiveDate ?? 'Not recorded'],
        ['Transaction reason', event.reason],
        [
          'Effective-date interpretation',
          'This is the retained contractual revision. Changes apply from the stated transaction effective date; recording a future-effective change does not make it current cover.',
        ],
      ],
    },
  ];
  if (submission && definition) {
    const answer = (
      field: { type: string; options?: { id: string; label: string }[] },
      value: unknown,
    ) =>
      field.type === 'money'
        ? money(String(value), record.currency)
        : typeof value === 'boolean'
          ? value
            ? 'Yes'
            : 'No'
          : field.type === 'choice'
            ? (field.options?.find((option) => option.id === value)?.label ?? String(value))
            : String(value);
    sections.push({
      title: 'Retained risk answers',
      rows: definition.riskFields.map((field): [string, string] => [
        field.label,
        submission.answers[field.id] === undefined
          ? 'Not supplied'
          : answer(field, submission.answers[field.id]),
      ]),
    });
    if (definition.schemaVersion === 'insurance-product-v2' && submissionV2) {
      for (const group of submissionV2.riskGroups) {
        const description = definition.riskGroups.find((item) => item.id === group.groupId);
        for (const row of group.rows)
          sections.push({
            title: `${description?.label ?? group.groupId} / ${row.rowId}`,
            rows: (description?.fields ?? []).map((field): [string, string] => [
              field.label,
              row.answers[field.id] === undefined
                ? 'Not supplied'
                : answer(field, row.answers[field.id]),
            ]),
          });
      }
    }
  }
  if (template.kind === 'coverage_schedule') {
    const selections = submission?.coverages ?? [];
    for (const coverage of selections) {
      const rows: [string, string][] = [];
      const declared = definition?.coverages.find((item) => item.id === coverage.coverageId);
      rows.push(['Coverage', declared ? `${declared.name} / ${declared.id}` : coverage.coverageId]);
      const selectedV2 = submissionV2?.coverages[selections.indexOf(coverage)];
      if (selectedV2)
        rows.push([
          'Covered risk scope',
          selectedV2.scope.kind === 'risk'
            ? `${selectedV2.scope.groupId} / ${selectedV2.scope.rowId}`
            : 'Policy',
        ]);
      rows.push([
        'Limit basis',
        declared && 'limitBasis' in declared
          ? title(declared.limitBasis)
          : declared && 'basis' in declared
            ? title(declared.basis)
            : 'Not recorded',
      ]);
      rows.push(
        ['Selected limit', money(coverage.limitMinor, record.currency)],
        ['Selected fixed deductible', money(coverage.deductibleMinor, record.currency)],
      );
      if (declared && 'layer' in declared)
        rows.push([
          'Coverage layer',
          declared.layer.kind === 'excess'
            ? `Excess over ${declared.layer.underlyingCoverageId}`
            : 'Primary',
        ]);
      if (selectedV2?.aggregateMinor !== undefined)
        rows.push(
          ['Selected aggregate', money(selectedV2.aggregateMinor, record.currency)],
          [
            'Aggregate basis',
            declared && 'aggregateLimit' in declared && declared.aggregateLimit
              ? title(declared.aggregateLimit.basis)
              : 'Not recorded',
          ],
        );
      if (selectedV2?.attachmentMinor !== undefined)
        rows.push(['Excess attachment', money(selectedV2.attachmentMinor, record.currency)]);
      if (declared) rows.push(['Coverage source references', declared.sourceRefs.join('\n')]);
      sections.push({ title: `Retained coverage: ${declared?.name ?? coverage.coverageId}`, rows });
    }
    if (!selections.length)
      sections.push({
        title: 'Retained coverage selections',
        rows: [
          [
            'Coverage detail',
            'No typed coverage selection is retained on this external quote. No coverage, limit or deductible is inferred.',
          ],
        ],
      });
  }
  sections.push({
    title: 'Financial snapshot',
    rows: [
      ['Premium after this transaction', money(record.premiumMinor, record.currency)],
      ['Premium change on this event', money(event.premiumDeltaMinor, record.currency)],
      ...record.financials.allocations.map((item): [string, string] => [
        `${title(item.role)}: ${item.participantId} (${percent(item.shareBps)})`,
        money(item.premiumMinor, record.currency),
      ]),
      [
        'Separate calculated commission',
        money(record.financials.commission.amountMinor, record.currency),
      ],
      [
        'Commission rate / base',
        `${percent(record.financials.commission.rateBps)} / ${title(record.financials.commission.base)}`,
      ],
      ['Commission recipient', record.financials.commission.recipientId],
      ['Settlement party', record.financials.commission.settlementPartyId],
      ['Cash custody', title(record.financials.commission.cashCustody)],
    ],
  });
  if (record.configuredCancellation) {
    const cancellation = record.configuredCancellation;
    sections.push({
      title: 'Retained cancellation calculation',
      rows: [
        ['Cancellation effective date', cancellation.effectiveDate],
        [
          'Return premium calculated',
          cancellation.calculation
            ? money(cancellation.calculation.returnPremiumMinor, record.currency)
            : 'No calculation retained',
        ],
        [
          'Calculation method',
          cancellation.calculation ? title(cancellation.calculation.method) : 'Not recorded',
        ],
        [
          'Remaining days',
          cancellation.calculation
            ? `${cancellation.calculation.remainingDays} of ${cancellation.calculation.termDays}`
            : 'Not recorded',
        ],
        [
          'Refund instruction',
          `${title(cancellation.refundStatus)}. This calculation does not request or verify a cash refund.`,
        ],
        [
          'Cancellation notice',
          `${title(cancellation.noticeStatus)} by the cancellation command. This separately generated training document does not send a notice.`,
        ],
        ['Cancellation reason', cancellation.reason],
        ['Cancellation evidence references', cancellation.evidenceRefs.join('\n')],
        [
          'Configured return rule references',
          definition?.schemaVersion === 'insurance-product-v2'
            ? (definition.cancellation?.sourceRefs.join('\n') ?? 'Not recorded')
            : 'Not recorded',
        ],
        ['Cancellation evaluation hash', cancellation.evaluationHash],
      ],
    });
  }
  if (record.renewal)
    sections.push({
      title: 'Separate linked renewal term',
      rows: [
        [
          'Expiring record / revision',
          `${record.renewal.source.recordId} / ${record.renewal.source.version}`,
        ],
        ['Expiring record hash', record.renewal.source.recordHash],
        ['Expiring submission hash', record.renewal.source.submissionHash],
        [
          'Changed sections',
          record.renewal.comparison.changedSections.join(', ') || 'No section change recorded',
        ],
        ['Added risk rows', record.renewal.comparison.addedRiskRows.join(', ') || 'None'],
        ['Removed risk rows', record.renewal.comparison.removedRiskRows.join(', ') || 'None'],
        ['Changed risk rows', record.renewal.comparison.changedRiskRows.join(', ') || 'None'],
        [
          'Renewal boundary',
          'This document describes the new retained term. The expiring policy and its documents remain separate.',
        ],
      ],
    });
  sections.push({
    title: 'Template and source provenance',
    rows: [
      ['Generated by', `${request.pack.issuerLabel} - training document generator, not insurer`],
      ['Evidence boundary', 'Synthetic training only; no customer approval or insurance issuance'],
      [
        'Pack / template',
        `${request.pack.id} ${request.pack.version} / ${template.id} ${template.version}`,
      ],
      ['Template wording', template.wording],
      ['Template source references', template.sourceRefs.join('\n')],
      ['Legal references (unverified)', template.legalRefs.join('\n')],
      ['Pack source references', request.pack.sourceRefs.join('\n')],
      [
        'Transaction source references',
        (submission?.evidenceRefs ?? record.quote.sourceQuote.evidenceRefs).join('\n'),
      ],
      ...(record.configuredService
        ? [
            ['Service decision references', record.configuredService.evidenceRefs.join('\n')] as [
              string,
              string,
            ],
          ]
        : []),
    ],
  });
  sections.push({
    title: 'Exact retained evidence',
    rows: [
      ['Recorded at (UTC)', request.createdAt],
      ['Document actor', request.actorId],
      ['Correlation', request.correlationId],
      ['Record hash', record.recordHash],
      ['Quote hash', record.quoteHash],
      ['Snapshot hash', request.snapshotHash],
      ['Pack hash', request.packHash],
      ['Operating policy hash', record.productPolicyHash],
      ['Runtime release', record.runtimeReleaseId ?? 'Not recorded'],
      ...(record.decision
        ? ([
            ['Product definition hash', record.decision.evaluation.definitionHash],
            ['Product decision hash', record.decision.evaluation.evaluationHash],
          ] as [string, string][])
        : []),
      ...(record.configuredService
        ? [
            ['Service evaluation hash', record.configuredService.evaluationHash] as [
              string,
              string,
            ],
            [
              'Serviced product decision hash',
              record.configuredService.evaluation.evaluationHash,
            ] as [string, string],
            ['Service effective date', record.configuredService.effectiveDate] as [string, string],
          ]
        : []),
      ...(record.approval
        ? ([
            [
              'Retained human review',
              `${record.approval.approvalId} / ${record.approval.approvalHash}`,
            ],
          ] as [string, string][])
        : []),
    ],
  });
  return sections;
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[letter]!,
  );
function html(request: DocumentRequest, template: Template, sections: Section[]) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(template.title)}</title><style>body{font:15px/1.55 Arial,sans-serif;color:#183343;background:#f3f6f8;margin:0}main{max-width:900px;margin:32px auto;padding:36px;background:white}h1{font-size:30px;line-height:1.2}h2{margin-top:32px;color:#0a5962;font-size:19px}.notice{padding:14px;border-left:4px solid #aa641b;background:#fff4df}.meta{color:#476272}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:10px 8px;border-bottom:1px solid #e0e8ec;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{width:32%;font-weight:600}footer{margin-top:32px;font-size:12px;color:#476272}@media(max-width:600px){main{padding:18px;margin:0}h1{font-size:25px}th{width:35%}}@media print{body{background:white}main{margin:0;padding:0}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body><main><p class="meta">FACIO PLATFORM / SANDBOX DOCUMENT</p><h1>${escapeHtml(template.title)}</h1><p class="notice"><strong>SYNTHETIC TRAINING - NOT INSURANCE COVER</strong><br>${escapeHtml(template.wording)}</p>${sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2><table>${section.rows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table></section>`).join('')}<footer>${escapeHtml(documentNumber(request, template))} / retained transaction ${request.recordVersion}. This document does not send a communication, collect money or issue actual insurance.</footer></main></body></html>`;
}
async function pdf(request: DocumentRequest, template: Template, sections: Section[]) {
  const document = await PDFDocument.create();
  document.setTitle(template.title);
  document.setAuthor(request.pack.issuerLabel);
  document.setSubject('Synthetic training document - not insurance cover');
  document.setCreator('Facio insurance-document-v1');
  document.setProducer('Facio insurance-document-v1');
  document.setCreationDate(new Date(request.createdAt));
  document.setModificationDate(new Date(request.createdAt));
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.19, 0.25),
    muted = rgb(0.28, 0.39, 0.45),
    teal = rgb(0.04, 0.35, 0.38);
  let page!: PDFPage;
  let y = 0;
  const wrap = (value: string, face: PDFFont, size: number, width: number): string[] => {
    const output: string[] = [];
    // PDF text uses individual glyph advances; measuring kerning pairs can underestimate a rendered line.
    const widthOf = (text: string) =>
      Array.from(text).reduce((sum, char) => sum + face.widthOfTextAtSize(char, size), 0);
    for (const paragraph of value.split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (widthOf((line ? line + ' ' : '') + word) <= width) {
          line += (line ? ' ' : '') + word;
          continue;
        }
        if (line) output.push(line);
        line = '';
        for (const char of word) {
          if (widthOf(line + char) > width && line) {
            output.push(line);
            line = '';
          }
          line += char;
        }
      }
      output.push(line);
    }
    return output;
  };
  const newPage = () => {
    page = document.addPage([595.28, 841.89]);
    y = 780;
    page.drawText('FACIO PLATFORM / SANDBOX DOCUMENT', {
      x: 44,
      y: 809,
      size: 9,
      font: bold,
      color: teal,
    });
    page.drawLine({ start: { x: 44, y: 797 }, end: { x: 551, y: 797 }, thickness: 1, color: teal });
  };
  const ensure = (height: number) => {
    if (y - height < 62) newPage();
  };
  const paragraph = (value: string, face = font, size = 10, color = ink, gap = 8) => {
    for (const line of wrap(value, face, size, 507)) {
      ensure(size + 5);
      page.drawText(line, { x: 44, y, size, font: face, color });
      y -= size + 5;
    }
    y -= gap;
  };
  newPage();
  paragraph(template.title, bold, 23, ink, 12);
  paragraph('SYNTHETIC TRAINING - NOT INSURANCE COVER', bold, 11, rgb(0.55, 0.28, 0.06));
  paragraph(template.wording, font, 10, muted, 12);
  for (const section of sections) {
    ensure(60);
    paragraph(section.title, bold, 14, teal, 7);
    for (const [label, value] of section.rows) {
      const labels = wrap(label, bold, 9, 153),
        values = wrap(value, font, 9, 331);
      const count = Math.max(labels.length, values.length);
      for (let start = 0; start < count;) {
        if (y - 28 < 62) {
          newPage();
          paragraph(`${section.title} (continued)`, bold, 14, teal, 7);
        }
        const fit = Math.min(count - start, Math.max(1, Math.floor((y - 70) / 13)));
        for (let n = 0; n < fit; n++) {
          if (labels[start + n])
            page.drawText(labels[start + n]!, {
              x: 44,
              y: y - n * 13,
              size: 9,
              font: bold,
              color: muted,
            });
          if (values[start + n])
            page.drawText(values[start + n]!, { x: 215, y: y - n * 13, size: 9, font, color: ink });
        }
        y -= fit * 13;
        start += fit;
        page.drawLine({
          start: { x: 44, y: y + 5 },
          end: { x: 551, y: y + 5 },
          thickness: 0.4,
          color: rgb(0.85, 0.89, 0.91),
        });
        y -= 11;
      }
    }
    y -= 11;
  }
  document.getPages().forEach((item, index) => {
    item.drawText('SYNTHETIC / No insurer obligation / Pack ' + request.documentNumber, {
      x: 44,
      y: 35,
      size: 7,
      font,
      color: muted,
    });
    item.drawText(`${index + 1} / ${document.getPageCount()}`, {
      x: 516,
      y: 35,
      size: 8,
      font,
      color: muted,
    });
  });
  return document.save();
}
/** Async CPU rendering runs outside SQLite transactions and performs no network/file access. */
export async function renderDocumentPack(request: DocumentRequest): Promise<RenderedDocument[]> {
  const artifacts: RenderedDocument[] = [];
  for (const template of request.pack.templates) {
    const sections = documentSections(request, template);
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await pdf(request, template, sections);
    } catch (error) {
      if (String(error).includes('WinAnsi'))
        throw new KernelError(
          'UNSUPPORTED_GLYPH',
          'The registered PDF renderer cannot represent a character in this snapshot; a compatible font renderer is required',
          422,
        );
      throw error;
    }
    const outputs = { pdf: pdfBytes, html: Buffer.from(html(request, template, sections), 'utf8') };
    for (const format of ['pdf', 'html'] as const) {
      if (!outputs[format].byteLength || outputs[format].byteLength > MAX_DOCUMENT_BYTES)
        throw new KernelError(
          'OUTPUT_TOO_LARGE',
          'The generated document exceeds its bounded artifact size',
          422,
        );
      artifacts.push({
        templateId: template.id,
        templateVersion: template.version,
        format,
        bytes: outputs[format],
      });
    }
  }
  return artifacts;
}
