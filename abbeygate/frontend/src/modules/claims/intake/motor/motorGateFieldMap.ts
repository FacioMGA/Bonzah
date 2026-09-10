export type GateFieldMapItem = {
  gateKey: string;
  requiredPaths: string[];
  sectionId: string;
  label: string;
};

export const motorGateFieldMap: GateFieldMapItem[] = [
  {
    gateKey: 'lossTypePresent',
    requiredPaths: ['incident.type'],
    sectionId: 'incident',
    label: 'Loss type',
  },
  {
    gateKey: 'dateOfLossPresent',
    requiredPaths: ['incident.date'],
    sectionId: 'incident',
    label: 'Date of loss',
  },
  {
    gateKey: 'locationPresent',
    requiredPaths: ['incident.location.address'],
    sectionId: 'incident',
    label: 'Location',
  },
  {
    gateKey: 'narrativePresent',
    requiredPaths: ['incident.description'],
    sectionId: 'narrative',
    label: 'Narrative',
  },
  {
    gateKey: 'fnolConfirmed',
    requiredPaths: [],
    sectionId: 'narrative',
    label: 'FNOL confirmation',
  },
];

export function resolveMotorMissingFields(args: {
  gates: Array<{ key: string; label: string; status: 'PASS' | 'FAIL'; reason?: string }>;
  snapshot: Record<string, unknown>;
}) {
  void args.snapshot;
  const items = args.gates
    .filter((gate) => gate.status === 'FAIL')
    .flatMap((gate) => {
      const mapping = motorGateFieldMap.find((item) => item.gateKey === gate.key);
      if (!mapping) {
        return [{ gateKey: gate.key, sectionId: 'incident', path: '', label: gate.label, reason: gate.reason }];
      }
      // Confirmation is an action/state transition, not a "missing field".
      if (mapping.gateKey === 'fnolConfirmed') return [];
      const firstPath = mapping.requiredPaths[0] || '';
      return [{
        gateKey: gate.key,
        sectionId: mapping.sectionId,
        path: firstPath,
        label: mapping.label,
        reason: gate.reason,
      }];
    });
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.gateKey}::${item.sectionId}::${item.path || item.label}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
