import { randomUUID } from 'node:crypto';
import type { Context, Scope } from '../contracts/configuration.js';
import {
  fnolDestinationSchema,
  fnolNoticeSchema,
  fnolViewSchema,
  fnolOperations,
  type FnolDestination,
  type FnolNotice,
  type FnolOperationName,
} from '../contracts/fnol.js';
import type { Store } from '../storage/store.js';
import { hash, KernelError } from '../domain/canonical.js';
function fail(code: string, message: string, status = 422): never {
  throw new KernelError(code, message, status);
}
const make = (value: Omit<FnolNotice, 'noticeHash'>) =>
  fnolNoticeSchema.parse({ ...value, noticeHash: hash(value) });
export class FnolApplication {
  private readonly destinations: Map<string, FnolDestination>;
  constructor(
    private readonly store: Store,
    destinations: FnolDestination[] = [],
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.destinations = new Map();
    for (const raw of destinations) {
      const item = fnolDestinationSchema.parse(raw),
        key = `${item.id}@${item.version}`;
      if (this.destinations.has(key))
        throw new Error('FNOL destination version is already registered');
      this.destinations.set(key, structuredClone(item));
    }
  }
  private duplicates(scope: Scope, notice: FnolNotice) {
    const lossDate = notice.details.loss.occurredAt.slice(0, 10),
      location = notice.details.loss.location.trim().toLowerCase();
    if (!lossDate || !location) return [];
    return this.store.fnol.related(scope, notice.policySnapshot.id, notice.id, lossDate, location);
  }
  private assessment(notice: FnolNotice, context: Context) {
    const policy = notice.policySnapshot,
      submission = policy.configuredService?.submission ?? policy.decision?.submission;
    const term = submission?.term ?? policy.quote.term,
      loss = notice.details.loss,
      lossDate = loss.occurredAt ? loss.occurredAt.slice(0, 10) : null;
    const termStatus = lossDate
      ? lossDate >= term.startDate && lossDate <= term.endDate
        ? 'within_recorded_term'
        : 'outside_recorded_term'
      : 'not_supplied';
    const flags = [
      'This is notice intake only. Policy wording, coverage, liability, reserving and settlement are not determined.',
      'The term comparison uses the loss calendar date in its reported UTC offset. Policy timezone wording remains outside this training check.',
    ];
    if (termStatus === 'outside_recorded_term')
      flags.push(
        'The reported loss date falls outside this selected historical term. Preserve the notice for review; this flag is not a coverage denial.',
      );
    if (policy.status === 'cancelled')
      flags.push(
        `The selected revision records cancellation effective ${policy.lastEffectiveDate ?? 'date not recorded'}. Review its chronology; a future-effective cancellation does not prove cover had ceased on the loss date.`,
      );
    if (policy.configuredService && lossDate && lossDate < policy.configuredService.effectiveDate)
      flags.push(
        `The selected serviced revision takes effect ${policy.configuredService.effectiveDate}, after the reported loss date. Earlier policy history must be reviewed.`,
      );
    const possibleDuplicateIds =
      notice.status === 'draft' ? this.duplicates(context, notice) : notice.possibleDuplicateIds;
    if (possibleDuplicateIds.length)
      flags.push(
        `${possibleDuplicateIds.length} possible related notices share this policy record, reported loss date and normalized location. This is a bounded comparison, not an identity or fraud finding.`,
      );
    if (possibleDuplicateIds.length === 100)
      flags.push(
        'The duplicate view retains up to 100 matching notices; further matching history may exist and needs review.',
      );
    const issues: { path: string; message: string }[] = [];
    const required = (path: string, value: string, message: string) => {
      if (!value.trim()) issues.push({ path, message });
    };
    required(
      'insured.displayName',
      notice.details.insured.displayName,
      'Enter the declared insured name.',
    );
    required(
      'reporter.displayName',
      notice.details.reporter.displayName,
      'Enter the reporter name.',
    );
    required(
      'preparer.displayName',
      notice.details.preparer.displayName,
      'Enter the preparer name and declared role.',
    );
    required(
      'loss.occurredAt',
      loss.occurredAt,
      'Enter the reported accident or loss timestamp with its UTC offset.',
    );
    required(
      'loss.reportedTimeZone',
      loss.reportedTimeZone,
      'Record the source timezone interpretation.',
    );
    required(
      'loss.location',
      loss.location,
      'Enter the loss location or a retained location reference.',
    );
    required(
      'loss.description',
      loss.description,
      'Describe the reported loss without unnecessary sensitive details.',
    );
    if (!notice.details.reporter.contact.email && !notice.details.reporter.contact.phone)
      issues.push({ path: 'reporter.contact', message: 'Enter one reporter contact method.' });
    if (loss.occurredAt && Date.parse(loss.occurredAt) > this.clock().getTime())
      issues.push({
        path: 'loss.occurredAt',
        message:
          'A reported loss cannot have a future timestamp; correct or clarify the source date.',
      });
    if (!notice.details.evidence.length)
      issues.push({
        path: 'evidence',
        message:
          'Retain at least one evidence reference; a reference does not verify an uploaded file.',
      });
    if (!notice.details.declaration.confirmed)
      issues.push({
        path: 'declaration.confirmed',
        message:
          'Confirm the training declaration before submission; this is not an electronic legal signature.',
      });
    return {
      lossCalendarDate: lossDate,
      term,
      termStatus,
      dateBasis: 'reported_loss_offset_calendar_date' as const,
      flags,
      possibleDuplicateIds,
      canSubmit:
        notice.status === 'draft' &&
        !issues.length &&
        context.permissions.some((p) => p === 'fnol:write'),
      submitIssues: issues,
      canHandoff:
        notice.status === 'submitted' && context.permissions.some((p) => p === 'fnol:handoff'),
      adjudication: 'not_performed' as const,
      publicLink: 'not_implemented' as const,
    };
  }
  private view(scope: Scope, id: string, context: Context, version?: number) {
    const history = this.store.fnol.history(scope, id, version),
      notice = history.at(-1)!;
    const retained = this.store.insuranceHistory(scope, notice.policySnapshot.id).revisions[
      notice.policySnapshot.version - 1
    ];
    if (!retained || retained.recordHash !== notice.policySnapshot.recordHash)
      fail(
        'INTEGRITY_ERROR',
        'FNOL source differs from the exact retained insurance revision',
        500,
      );
    return fnolViewSchema.parse({ notice, history, assessment: this.assessment(notice, context) });
  }
  execute(name: FnolOperationName, raw: unknown, context: Context): unknown {
    const operation = fnolOperations[name];
    if (!context.permissions.some((permission) => permission === operation.permission))
      fail('FORBIDDEN', 'This actor cannot perform the FNOL operation', 403);
    if (!['development', 'sandbox'].includes(context.environment))
      fail(
        'RUNTIME_ENVIRONMENT_UNSUPPORTED',
        'This FNOL intake registration is training only',
        403,
      );
    if (name === 'fnol_catalog') {
      operation.input.parse(raw);
      return {
        destinations: [...this.destinations.values()].map((destination) => ({
          destination: structuredClone(destination),
          destinationHash: hash(destination),
        })),
      };
    }
    if (name === 'fnol_get') {
      const input = fnolOperations.fnol_get.input.parse(raw);
      return this.view(context, input.noticeId, context);
    }
    if (name === 'fnol_list') {
      const input = fnolOperations.fnol_list.input.parse(raw);
      this.store.insuranceRead(context, input.recordId);
      const result = this.store.fnol.list(context, input.recordId);
      return {
        notices: result.notices.map((item) => this.view(context, item.id, context)),
        hasMore: result.hasMore,
      };
    }
    const input = fnolOperations[name].input.parse(raw),
      requestHash = hash({ input, actorId: context.actorId });
    const replay = this.store.fnol.replay(context, name, input.idempotencyKey, requestHash);
    if (replay) return this.view(context, replay.noticeId, context, replay.version);
    const now = this.clock().toISOString();
    let result: FnolNotice;
    if (name === 'fnol_create') {
      const command = fnolOperations.fnol_create.input.parse(input),
        { idempotencyKey: _, ...source } = command,
        sourceRequestHash = hash(source);
      const existing = this.store.fnol.source(context, command.sourceReference);
      if (existing) {
        if (existing.sourceRequestHash !== sourceRequestHash)
          fail(
            'FNOL_SOURCE_CONFLICT',
            'This source reference already belongs to a notice with different facts. Inspect its history; it cannot be overwritten.',
            409,
          );
        result = existing;
      } else {
        const policy = this.store.insuranceHistory(context, command.recordId).revisions[
          command.recordVersion - 1
        ];
        if (!policy || policy.recordHash !== command.recordHash)
          fail(
            'VERSION_CONFLICT',
            'Select the exact retained policy version and hash before creating intake.',
            409,
          );
        if (policy.status === 'quoted')
          fail(
            'FNOL_POLICY_NOT_BOUND',
            'The selected historical revision is a quote; choose a retained bound or service transaction.',
            409,
          );
        const destination = this.destinations.get(
          `${command.destinationId}@${command.destinationVersion}`,
        );
        if (!destination)
          fail(
            'FNOL_DESTINATION_UNCONFIGURED',
            'The destination version is not registered for internal training intake.',
            409,
          );
        result = make({
          id: randomUUID(),
          scope: {
            workspaceId: context.workspaceId,
            tenantId: context.tenantId,
            environment: context.environment,
            operatingEntityId: context.operatingEntityId,
          },
          version: 1,
          previousNoticeHash: null,
          sourceReference: command.sourceReference,
          sourceRequestHash,
          policySnapshot: policy,
          policySnapshotHash: hash(policy),
          destination: structuredClone(destination),
          destinationHash: hash(destination),
          details: command.details,
          status: 'draft',
          possibleDuplicateIds: [],
          duplicateReview: null,
          createdBy: context.actorId,
          createdAt: now,
          actorId: context.actorId,
          correlationId: context.correlationId,
          occurredAt: now,
          submittedAt: null,
          acknowledgement: null,
        });
        const { noticeHash: __, ...content } = result;
        result = make({ ...content, possibleDuplicateIds: this.duplicates(context, result) });
        this.store.fnol.append(result);
        this.store.fnol.registerSource(result);
      }
    } else {
      const command = fnolOperations[name].input.parse(input),
        current = this.store.fnol.read(context, command.noticeId);
      if (current.version !== command.expectedVersion || current.noticeHash !== command.noticeHash)
        fail(
          'VERSION_CONFLICT',
          'This notice changed. Refresh its exact retained revision before saving or handing off.',
          409,
        );
      const { noticeHash: _, ...content } = current;
      const next = {
        ...content,
        version: current.version + 1,
        previousNoticeHash: current.noticeHash,
        actorId: context.actorId,
        correlationId: context.correlationId,
        occurredAt: now,
      };
      if (name === 'fnol_update') {
        if (current.status !== 'draft')
          fail(
            'INVALID_TRANSITION',
            'Submitted facts are immutable; retain a separately identified related notice for later information.',
            409,
          );
        const details = fnolOperations.fnol_update.input.parse(command).details;
        result = make({ ...next, details });
        const { noticeHash: __, ...updated } = result;
        result = make({ ...updated, possibleDuplicateIds: this.duplicates(context, result) });
      } else if (name === 'fnol_submit') {
        if (current.status !== 'draft')
          fail(
            'INVALID_TRANSITION',
            'This notice has already been submitted; inspect its acknowledgement.',
            409,
          );
        const assessment = this.assessment(current, context);
        if (assessment.submitIssues.length)
          fail(
            'FNOL_VALIDATION_FAILED',
            assessment.submitIssues.map((item) => item.message).join(' '),
          );
        const possibleDuplicateIds = this.duplicates(context, current),
          duplicateReview = fnolOperations.fnol_submit.input.parse(command).duplicateReview;
        if (possibleDuplicateIds.length && !duplicateReview)
          fail(
            'FNOL_DUPLICATE_REVIEW_REQUIRED',
            'Review the possible duplicate and record a disposition and rationale before submitting.',
            409,
          );
        result = make({
          ...next,
          status: 'submitted',
          submittedAt: now,
          possibleDuplicateIds,
          duplicateReview,
        });
      } else {
        if (current.status !== 'submitted')
          fail(
            'INVALID_TRANSITION',
            'Only a submitted notice can receive this internal handoff acknowledgement.',
            409,
          );
        result = make({
          ...next,
          status: 'acknowledged',
          acknowledgement: {
            id: randomUUID(),
            destinationHash: current.destinationHash,
            submittedNoticeHash: current.noticeHash,
            acknowledgedAt: now,
            kind: 'synthetic_internal_queue_receipt',
            externalDelivery: 'not_attempted',
          },
        });
      }
      this.store.fnol.append(result);
    }
    this.store.fnol.remember(context, name, input.idempotencyKey, requestHash, result);
    return this.view(context, result.id, context, result.version);
  }
}
