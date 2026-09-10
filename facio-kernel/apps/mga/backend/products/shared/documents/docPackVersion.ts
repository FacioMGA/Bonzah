/**
 * Issuance recovery replays the canonical issued-pack event after a failed or
 * partial attempt. The replay must continue the active version; a new version
 * is only appropriate for pack kinds that explicitly support regeneration.
 */
export function resolveDocPackVersion(args: {
  docPack: string;
  latestVersion: number | null;
  activeVersion: number | null;
}): number {
  if (args.docPack === 'ISSUED_POLICY_PACK' && args.activeVersion !== null) {
    return args.activeVersion;
  }
  return (args.latestVersion || 0) + 1;
}
