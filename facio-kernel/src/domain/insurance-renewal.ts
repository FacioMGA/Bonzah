import type { ConfiguredSubmission } from '../contracts/insurance-definition.js';
import { configuredSubmissionV2Schema } from '../contracts/insurance-definition.js';
import { hash } from './canonical.js';
export function compareRenewalSubmissions(
  before: ConfiguredSubmission,
  after: ConfiguredSubmission,
) {
  const keys = ['answers', 'coverages', 'territory', 'term', 'summary', 'evidenceRefs'] as const;
  const changedSections = keys.filter((key) => hash(before[key]) !== hash(after[key]));
  const rows = (input: ConfiguredSubmission) => {
    const parsed = configuredSubmissionV2Schema.safeParse(input);
    return new Map(
      parsed.success
        ? parsed.data.riskGroups.flatMap((group) =>
            group.rows.map((row) => [group.groupId + ':' + row.rowId, hash(row.answers)] as const),
          )
        : [],
    );
  };
  const oldRows = rows(before),
    newRows = rows(after);
  return {
    changedSections,
    addedRiskRows: [...newRows.keys()].filter((key) => !oldRows.has(key)).sort(),
    removedRiskRows: [...oldRows.keys()].filter((key) => !newRows.has(key)).sort(),
    changedRiskRows: [...newRows.keys()]
      .filter((key) => oldRows.has(key) && oldRows.get(key) !== newRows.get(key))
      .sort(),
  };
}
