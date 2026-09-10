import { randomUUID } from 'node:crypto';
import type { Context, Scope } from '../contracts/configuration.js';
import { scopeSchema } from '../contracts/configuration.js';
import {
  documentOperations,
  documentRequestSchema,
  documentStateSchema,
  documentArtifactSchema,
  documentViewSchema,
  MAX_DOCUMENT_BYTES,
  type DocumentOperationName,
  type DocumentPack,
  type DocumentRequest,
  type DocumentState,
} from '../contracts/documents.js';
import { DocumentPackRegistry } from '../domain/document-registry.js';
import { renderDocumentPack, type RenderedDocument } from '../domain/document-renderer.js';
import { documentBytesHash } from '../storage/documents.js';
import type { Store } from '../storage/store.js';
import { hash, KernelError } from '../domain/canonical.js';

function fail(code: string, message: string, status = 422): never {
  throw new KernelError(code, message, status);
}
const withoutClaim = ({ claim: _, ...state }: DocumentState) => state;
const state = (value: Omit<DocumentState, 'stateHash'>) =>
  documentStateSchema.parse({ ...value, stateHash: hash(value) });
export class DocumentApplication {
  private readonly registry: DocumentPackRegistry;
  constructor(
    private readonly store: Store,
    packs: DocumentPack[] = [],
    private readonly clock: () => Date = () => new Date(),
    private readonly renderer: (
      request: DocumentRequest,
    ) => Promise<RenderedDocument[]> = renderDocumentPack,
  ) {
    this.registry = new DocumentPackRegistry(packs);
  }
  private retryable(current: DocumentState) {
    return (
      current.attempts < 3 &&
      (current.status === 'failed' ||
        (current.status === 'rendering' &&
          Date.parse(current.claim!.expiresAt) <= this.clock().getTime()))
    );
  }
  private view(scope: Scope, id: string, mayIssue = false) {
    const request = this.store.documents.request(scope, id);
    const history = this.store.documents.history(scope, id);
    const current = history.at(-1)!;
    const retained = this.store.insuranceHistory(scope, request.recordId).revisions[
      request.recordVersion - 1
    ];
    if (!retained || retained.recordHash !== request.recordHash)
      fail(
        'INTEGRITY_ERROR',
        'Document target differs from the retained insurance transaction',
        500,
      );
    const artifacts = this.store.documents.artifacts(scope, id);
    if (
      (current.status === 'completed' && artifacts.length !== request.pack.templates.length * 2) ||
      (current.status !== 'completed' && artifacts.length !== 0)
    )
      fail(
        'INTEGRITY_ERROR',
        'Document state does not match its complete retained artifact pack',
        500,
      );
    return documentViewSchema.parse({
      request,
      state: withoutClaim(current),
      history: history.map(withoutClaim),
      artifacts,
      canRetry: mayIssue && this.retryable(current),
      authority: 'synthetic_document_not_insurance_issuance',
    });
  }
  /** Called inside Kernel's synchronous transaction and authorization/audit boundary. */
  execute(name: DocumentOperationName, raw: unknown, context: Context): unknown {
    if (!['development', 'sandbox'].includes(context.environment))
      fail(
        'RUNTIME_ENVIRONMENT_UNSUPPORTED',
        'Registered document packs are sandbox training only',
        403,
      );
    const operation = documentOperations[name];
    if (!context.permissions.some((permission) => permission === operation.permission))
      fail('FORBIDDEN', 'The current actor cannot perform this document operation', 403);
    const mayIssue = context.permissions.some((permission) => permission === 'documents:issue');
    if (name === 'documents_catalog') {
      operation.input.parse(raw);
      return { packs: this.registry.list() };
    }
    if (name === 'documents_list') {
      const { recordId } = documentOperations.documents_list.input.parse(raw);
      this.store.insuranceRead(context, recordId);
      const result = this.store.documents.list(context, recordId);
      return {
        documents: result.requests.map((request) => this.view(context, request.id, mayIssue)),
        hasMore: result.hasMore,
      };
    }
    if (name === 'documents_get')
      return this.view(context, documentOperations.documents_get.input.parse(raw).jobId, mayIssue);
    if (name === 'documents_content') {
      const { artifactId } = documentOperations.documents_content.input.parse(raw);
      const { artifact, bytes } = this.store.documents.content(context, artifactId);
      this.view(context, artifact.jobId);
      return { artifact, encoding: 'base64', content: bytes.toString('base64') };
    }
    const input = documentOperations[name].input.parse(raw);
    const requestHash = hash({ input, actorId: context.actorId });
    const replay = this.store.documents.replay(context, name, input.idempotencyKey, requestHash);
    if (replay) return this.view(context, replay, mayIssue);
    const now = this.clock().toISOString();
    let id: string;
    if (name === 'documents_request') {
      const command = documentOperations.documents_request.input.parse(input);
      const history = this.store.insuranceHistory(context, command.recordId);
      const record = history.revisions[command.recordVersion - 1];
      const event = history.events[command.recordVersion - 1];
      if (!record || !event || record.recordHash !== command.recordHash)
        fail(
          'DOCUMENT_TARGET_CHANGED',
          'Inspect the exact retained transaction version and hash before requesting documents',
          409,
        );
      if (
        !['bound', 'endorsement', 'cancellation', 'reinstatement'].includes(event.type) ||
        record.status === 'quoted'
      )
        fail(
          'DOCUMENT_TRANSACTION_NOT_ISSUED',
          'Documents require a retained bound or service transaction; a quote cannot be issued by generating a document',
          409,
        );
      const pack = this.registry.get(command.packId, command.packVersion);
      const existing = this.store.documents.existing(
        context,
        record.id,
        record.version,
        pack.id,
        pack.version,
      );
      if (existing) {
        if (existing.packHash !== hash(pack))
          fail(
            'DOCUMENT_TEMPLATE_CHANGED',
            'Registered template bytes changed without a new pack version; retained documents remain unchanged',
            409,
          );
        id = existing.id;
      } else {
        id = randomUUID();
        const release = record.runtimeReleaseId
          ? this.store.control.release(context, record.runtimeReleaseId)
          : null;
        const definition = record.decision
          ? (release?.configuration.configuration.products.find(
              (product) =>
                product.id === record.productId && product.version === record.productVersion,
            )?.insurance ?? null)
          : null;
        if (
          record.decision &&
          (!definition || hash(definition) !== record.decision.evaluation.definitionHash)
        )
          fail(
            'DOCUMENT_DEFINITION_UNAVAILABLE',
            'The exact retained product definition is required to describe coverage semantics',
            409,
          );
        const snapshot = { record, event, definition };
        const content = {
          id,
          scope: scopeSchema.parse({
            workspaceId: context.workspaceId,
            tenantId: context.tenantId,
            environment: context.environment,
            operatingEntityId: context.operatingEntityId,
          }),
          documentNumber: 'TRN-' + id.replaceAll('-', '').toUpperCase(),
          recordId: record.id,
          recordVersion: record.version,
          recordHash: record.recordHash,
          pack,
          packHash: hash(pack),
          snapshot,
          snapshotHash: hash(snapshot),
          actorId: context.actorId,
          correlationId: context.correlationId,
          createdAt: now,
        };
        const request = documentRequestSchema.parse({ ...content, requestHash: hash(content) });
        this.store.documents.create(
          request,
          state({
            jobId: id,
            version: 1,
            status: 'queued',
            attempts: 0,
            claim: null,
            failureCode: null,
            actorId: context.actorId,
            correlationId: context.correlationId,
            occurredAt: now,
            previousStateHash: null,
          }),
        );
      }
    } else {
      const command = documentOperations.documents_retry.input.parse(input);
      id = command.jobId;
      const current = this.store.documents.state(context, id);
      if (current.version !== command.expectedVersion || current.stateHash !== command.stateHash)
        fail(
          'DOCUMENT_STATE_CHANGED',
          'Document processing changed; refresh its retained history before retrying',
          409,
        );
      if (!this.retryable(current))
        fail(
          'DOCUMENT_RETRY_UNAVAILABLE',
          'Only failed or expired processing can retry within the original three-attempt budget',
          409,
        );
      this.store.documents.append(
        context,
        state({
          jobId: id,
          version: current.version + 1,
          status: 'queued',
          attempts: current.attempts,
          claim: null,
          failureCode: null,
          actorId: context.actorId,
          correlationId: context.correlationId,
          occurredAt: now,
          previousStateHash: current.stateHash,
        }),
      );
    }
    this.store.documents.remember(context, name, input.idempotencyKey, requestHash, id);
    return this.view(context, id, mayIssue);
  }
  /** A worker claims/persists in short synchronous transactions; rendering never holds SQLite. */
  async runOne(): Promise<boolean> {
    const claimed = this.store.transaction(() => {
      const request = this.store.documents.nextQueued();
      if (!request) return null;
      const previous = this.store.documents.state(request.scope, request.id);
      if (previous.attempts >= 3)
        fail('INTEGRITY_ERROR', 'Queued document exceeded its fixed render budget', 500);
      const token = randomUUID();
      const next = state({
        jobId: request.id,
        version: previous.version + 1,
        status: 'rendering',
        attempts: previous.attempts + 1,
        claim: { token, expiresAt: new Date(this.clock().getTime() + 120000).toISOString() },
        failureCode: null,
        actorId: null,
        correlationId: request.correlationId,
        occurredAt: this.clock().toISOString(),
        previousStateHash: previous.stateHash,
      });
      this.store.documents.append(request.scope, next);
      return { request, token };
    });
    if (!claimed) return false;
    const { request, token } = claimed;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rendered = await Promise.race([
        this.renderer(structuredClone(request)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Document render time limit exceeded')), 30000);
        }),
      ]);
      const expected = request.pack.templates
        .flatMap((template) =>
          ['pdf', 'html'].map((format) => `${template.id}@${template.version}:${format}`),
        )
        .sort();
      const actual = rendered
        .map((item) => `${item.templateId}@${item.templateVersion}:${item.format}`)
        .sort();
      if (hash(expected) !== hash(actual))
        fail('RENDER_FAILED', 'Renderer returned an incomplete or unexpected template pack');
      this.store.transaction(() => {
        const current = this.store.documents.state(request.scope, request.id);
        if (current.status !== 'rendering' || current.claim?.token !== token) return;
        if (Date.parse(current.claim.expiresAt) <= this.clock().getTime())
          throw new KernelError('LEASE_EXPIRED', 'Document processing lease expired', 409);
        for (const output of rendered) {
          if (
            !(output.bytes instanceof Uint8Array) ||
            output.bytes.byteLength < 1 ||
            output.bytes.byteLength > MAX_DOCUMENT_BYTES
          )
            fail('OUTPUT_TOO_LARGE', 'Document output exceeds its byte limit');
          if (
            output.format === 'pdf' &&
            Buffer.from(output.bytes).subarray(0, 5).toString() !== '%PDF-'
          )
            fail('RENDER_FAILED', 'Renderer returned invalid PDF output');
          const artifact = documentArtifactSchema.parse({
            id: randomUUID(),
            jobId: request.id,
            templateId: output.templateId,
            templateVersion: output.templateVersion,
            documentNumber: request.documentNumber + '-' + output.templateId,
            documentVersion: request.recordVersion,
            format: output.format,
            mimeType: output.format === 'pdf' ? 'application/pdf' : 'text/html',
            filename: `${request.documentNumber}-${output.templateId}-v${request.recordVersion}.${output.format}`,
            byteLength: output.bytes.byteLength,
            contentHash: documentBytesHash(output.bytes),
            recordHash: request.recordHash,
            snapshotHash: request.snapshotHash,
            packHash: request.packHash,
            createdAt: this.clock().toISOString(),
          });
          this.store.documents.saveArtifact(request.scope, artifact, output.bytes);
        }
        this.store.documents.append(
          request.scope,
          state({
            jobId: request.id,
            version: current.version + 1,
            status: 'completed',
            attempts: current.attempts,
            claim: null,
            failureCode: null,
            actorId: null,
            correlationId: request.correlationId,
            occurredAt: this.clock().toISOString(),
            previousStateHash: current.stateHash,
          }),
        );
        this.view(request.scope, request.id);
      });
    } catch (error) {
      this.store.transaction(() => {
        const current = this.store.documents.state(request.scope, request.id);
        if (current.status !== 'rendering' || current.claim?.token !== token) return;
        const failureCode =
          error instanceof KernelError &&
          ['UNSUPPORTED_GLYPH', 'OUTPUT_TOO_LARGE', 'LEASE_EXPIRED'].includes(error.code)
            ? (error.code as 'UNSUPPORTED_GLYPH' | 'OUTPUT_TOO_LARGE' | 'LEASE_EXPIRED')
            : 'RENDER_FAILED';
        this.store.documents.append(
          request.scope,
          state({
            jobId: request.id,
            version: current.version + 1,
            status: 'failed',
            attempts: current.attempts,
            claim: null,
            failureCode,
            actorId: null,
            correlationId: request.correlationId,
            occurredAt: this.clock().toISOString(),
            previousStateHash: current.stateHash,
          }),
        );
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    return true;
  }
}
