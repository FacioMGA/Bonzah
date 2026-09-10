export type EvaluateBinderSimulationInput = {
  territory: string;
  riskLocationCountry: string;
  insuredDomicileCountry: string;
  insuredValue: number;
  allowedTerritories: string[];
  allowedRiskLocations: string[];
  allowedInsuredDomiciles: string[];
  coverholder1MaxMaterialDamage: number;
  coverholder2MaxMaterialDamage: number;
  maxVehicleValue: number;
};

export type EvaluateBinderSimulationResult = {
  pass: boolean;
  referralTarget: string | null;
  reasons: string[];
  matchedRules: Array<{
    ruleCode: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
  }>;
};

export function evaluateBinderSimulationPolicy(
  input: EvaluateBinderSimulationInput
): EvaluateBinderSimulationResult {
  const matchedRules: EvaluateBinderSimulationResult['matchedRules'] = [];
  const reasons: string[] = [];
  let referralTarget: string | null = null;

  const normalizedRisk = String(input.riskLocationCountry || '').trim();
  const normalizedDomicile = String(input.insuredDomicileCountry || '').trim();

  if (normalizedRisk && input.allowedRiskLocations.length > 0) {
    const allowed = input.allowedRiskLocations.some(
      (value) => String(value).toLowerCase() === normalizedRisk.toLowerCase()
    );
    if (!allowed) {
      const message = `Risk location '${normalizedRisk}' is outside binder scope.`;
      reasons.push(message);
      matchedRules.push({ ruleCode: 'RISK_LOCATION', status: 'fail', message });
    } else {
      matchedRules.push({ ruleCode: 'RISK_LOCATION', status: 'pass', message: `Risk location '${normalizedRisk}' is allowed.` });
    }
  }

  if (normalizedDomicile && input.allowedInsuredDomiciles.length > 0) {
    const allowed = input.allowedInsuredDomiciles.some(
      (value) => String(value).toLowerCase() === normalizedDomicile.toLowerCase()
    );
    if (!allowed) {
      const message = `Insured domicile '${normalizedDomicile}' is outside binder scope.`;
      reasons.push(message);
      matchedRules.push({ ruleCode: 'INSURED_DOMICILE', status: 'fail', message });
    } else {
      matchedRules.push({ ruleCode: 'INSURED_DOMICILE', status: 'pass', message: `Insured domicile '${normalizedDomicile}' is allowed.` });
    }
  }

  if (input.territory && input.allowedTerritories.length > 0) {
    const allowed = input.allowedTerritories.some(
      (territory) => String(territory).toLowerCase() === input.territory.toLowerCase()
    );
    if (!allowed) {
      const message = `Territory '${input.territory}' is not allowed by this binder.`;
      reasons.push(message);
      matchedRules.push({ ruleCode: 'TERRITORIAL_LIMIT', status: 'fail', message });
    } else {
      matchedRules.push({ ruleCode: 'TERRITORIAL_LIMIT', status: 'pass', message: `Territory '${input.territory}' is allowed.` });
    }
  }

  if (
    Number.isFinite(input.coverholder1MaxMaterialDamage) &&
    input.coverholder1MaxMaterialDamage > 0 &&
    Number.isFinite(input.insuredValue) &&
    input.insuredValue > 0 &&
    input.insuredValue > input.coverholder1MaxMaterialDamage
  ) {
    if (
      Number.isFinite(input.coverholder2MaxMaterialDamage) &&
      input.coverholder2MaxMaterialDamage > 0 &&
      input.insuredValue <= input.coverholder2MaxMaterialDamage
    ) {
      referralTarget = 'VOLANTE';
      const message = `Vehicle value ${input.insuredValue} exceeds coverholder authority ${input.coverholder1MaxMaterialDamage} and requires Volante referral.`;
      matchedRules.push({ ruleCode: 'AUTHORITY_BAND', status: 'warn', message });
      reasons.push(message);
    } else if (input.coverholder2MaxMaterialDamage > 0 && input.insuredValue > input.coverholder2MaxMaterialDamage) {
      const message = `Vehicle value ${input.insuredValue} exceeds maximum binder authority ${input.coverholder2MaxMaterialDamage}.`;
      matchedRules.push({ ruleCode: 'AUTHORITY_BAND', status: 'fail', message });
      reasons.push(message);
    } else {
      const message = `Vehicle value ${input.insuredValue} exceeds authority threshold ${input.coverholder1MaxMaterialDamage}.`;
      matchedRules.push({ ruleCode: 'AUTHORITY_BAND', status: 'warn', message });
      reasons.push(message);
    }
  } else {
    matchedRules.push({
      ruleCode: 'AUTHORITY_BAND',
      status: 'pass',
      message: 'Vehicle value is within authority threshold.',
    });
  }

  if (
    Number.isFinite(input.maxVehicleValue) &&
    input.maxVehicleValue > 0 &&
    Number.isFinite(input.insuredValue) &&
    input.insuredValue > 0 &&
    input.insuredValue > input.maxVehicleValue
  ) {
    const message = `Vehicle value ${input.insuredValue} exceeds binder maxVehicleValue ${input.maxVehicleValue}.`;
    reasons.push(message);
    matchedRules.push({ ruleCode: 'MAX_VEHICLE_VALUE', status: 'fail', message });
  } else if (input.maxVehicleValue > 0) {
    matchedRules.push({ ruleCode: 'MAX_VEHICLE_VALUE', status: 'pass', message: 'Vehicle value is within binder maxVehicleValue.' });
  }

  return { pass: reasons.length === 0, referralTarget, reasons, matchedRules };
}
