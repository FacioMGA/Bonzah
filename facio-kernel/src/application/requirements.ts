import { scopeSchema, type Scope } from '../contracts/configuration.js';
import {
  requirementsReportSchema,
  scopedRequirementsProfileSchema,
  type RequirementsReport,
  type ScopedRequirementsProfile,
} from '../contracts/requirements.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';

const scopeKey = (scope: Scope) =>
  canonicalJson([scope.workspaceId, scope.tenantId, scope.environment, scope.operatingEntityId]);

/** Source evidence is immutable within this build. It makes no runtime or acceptance claim. */
export class RequirementsRegistry {
  private readonly profiles = new Map<string, ScopedRequirementsProfile>();

  constructor(profiles: readonly ScopedRequirementsProfile[]) {
    for (const raw of profiles) {
      // Parsing produces owned copies: callers cannot mutate the registered package afterward.
      const entry = scopedRequirementsProfileSchema.parse(raw);
      if (hash(entry.profile) !== entry.sourceProfileHash)
        throw new KernelError(
          'INTEGRITY_ERROR',
          'Source profile hash does not match its content',
          500,
        );
      const sourceIds = new Set(entry.profile.sources.map((source) => source.id));
      const requirementIds = new Set(
        entry.profile.requirements.map((requirement) => requirement.id),
      );
      if (
        sourceIds.size !== entry.profile.sources.length ||
        requirementIds.size !== entry.profile.requirements.length ||
        entry.profile.requirements.some(
          (requirement) =>
            new Set(requirement.categories).size !== requirement.categories.length ||
            requirement.sourceRefs.some((reference) => !sourceIds.has(reference.sourceId)),
        )
      )
        throw new KernelError(
          'INTEGRITY_ERROR',
          'Source profiles require unique identifiers and valid source references',
          500,
        );
      const key = scopeKey(entry.scope);
      if (this.profiles.has(key))
        throw new KernelError('INTEGRITY_ERROR', 'Only one source profile may own a scope', 500);
      this.profiles.set(key, entry);
    }
  }

  read(scope: Scope): RequirementsReport {
    // Context may also contain actor/permissions; project only the four authorized scope fields.
    const authorizedScope = scopeSchema.parse({
      workspaceId: scope.workspaceId,
      tenantId: scope.tenantId,
      environment: scope.environment,
      operatingEntityId: scope.operatingEntityId,
    });
    const entry = this.profiles.get(scopeKey(authorizedScope));
    // Schema parsing returns a fresh copy, so consumers cannot change future responses.
    return requirementsReportSchema.parse({
      scope: authorizedScope,
      sourceStatus: entry ? 'source_attached' : 'source_not_attached',
      sourceProfileHash: entry?.sourceProfileHash ?? null,
      profile: entry?.profile ?? null,
      runtimeStatus: 'pending_evidence',
      acceptanceStatus: 'not_recorded',
    });
  }
}
