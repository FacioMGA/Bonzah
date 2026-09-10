import { evaluateBinderSimulationPolicy } from '../../domain/binders/simulationPolicy.js';

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' ? (value as UnknownRecord) : {};

export type SimulateBinderCheckInput = {
  binderId: string;
  payload: {
    territory?: string;
    riskLocationCountry?: string;
    insuredDomicileCountry?: string;
    insuredValue?: number;
  };
};

export type SimulateBinderCheckDeps = {
  repo: {
    findBinderById(id: string): Promise<{ id: string; config: unknown } | null>;
    listActiveProgramLinksByBinderId(
      binderId: string
    ): Promise<Array<{ programStatus: string | null }>>;
  };
};

type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export async function simulateBinderCheckUseCase(
  input: SimulateBinderCheckInput,
  deps: SimulateBinderCheckDeps
): Promise<UseCaseResult> {
  const binder = await deps.repo.findBinderById(input.binderId);
  if (!binder) {
    return {
      status: 404,
      body: {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Binder not found' },
      },
    };
  }

  const config = asRecord(binder.config);
  const limits = asRecord(config.limits);
  const authority = asRecord(config.authority);
  const scope = asRecord(config.scope);
  const allowedTerritories = Array.isArray(authority.territories)
    ? authority.territories.map(String)
    : Array.isArray(authority.territorialLimits)
    ? authority.territorialLimits.map(String)
    : [];
  const allowedRiskLocations = Array.isArray(scope.riskLocationCountries)
    ? scope.riskLocationCountries.map(String)
    : Array.isArray(scope.riskLocation)
    ? scope.riskLocation.map(String)
    : [];
  const allowedInsuredDomiciles = Array.isArray(scope.insuredDomicileCountries)
    ? scope.insuredDomicileCountries.map(String)
    : Array.isArray(scope.insuredDomiciles)
    ? scope.insuredDomiciles.map(String)
    : [];

  const territory = String(input.payload.territory || '').trim();
  const riskLocationCountry = String(input.payload.riskLocationCountry || '').trim();
  const insuredDomicileCountry = String(input.payload.insuredDomicileCountry || '').trim();
  const insuredValue = Number(input.payload.insuredValue || 0);
  const maxByRole = asRecord(authority.maxInsuredValueByActor);
  const coverholder1MaxMaterialDamage = Number(
    String(maxByRole.coverholder1 || authority.coverholder1MaxMaterialDamage || '').replace(/[^\d.]/g, '')
  );
  const coverholder2MaxMaterialDamage = Number(
    String(maxByRole.coverholder2 || authority.coverholder2MaxMaterialDamage || '').replace(/[^\d.]/g, '')
  );
  const maxVehicleValue = Number(
    String(limits.maxVehicleValue || limits.vehicleValueMax || '').replace(/[^\d.]/g, '')
  );

  const evaluation = evaluateBinderSimulationPolicy({
    territory,
    riskLocationCountry,
    insuredDomicileCountry,
    insuredValue,
    allowedTerritories,
    allowedRiskLocations,
    allowedInsuredDomiciles,
    coverholder1MaxMaterialDamage,
    coverholder2MaxMaterialDamage,
    maxVehicleValue,
  });

  const links = await deps.repo.listActiveProgramLinksByBinderId(input.binderId);
  const authoritative = links.some(
    (link) => String(link.programStatus || '').toUpperCase() === 'ACTIVE'
  );

  return {
    status: 200,
    body: {
      success: true,
      data: {
        pass: evaluation.pass,
        authoritative,
        reasons: evaluation.reasons,
        matchedRules: evaluation.matchedRules,
        referralTarget: evaluation.referralTarget,
        evaluatedAt: new Date().toISOString(),
        inputs: {
          territory: territory || null,
          riskLocationCountry: riskLocationCountry || null,
          insuredDomicileCountry: insuredDomicileCountry || null,
          insuredValue: Number.isFinite(insuredValue) ? insuredValue : null,
        },
      },
    },
  };
}
