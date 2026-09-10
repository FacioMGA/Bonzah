type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function ageFromDob(value: unknown): number | null {
  const raw = asString(value);
  if (!raw) return null;
  const dob = new Date(raw);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  const age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  return monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) ? age - 1 : age;
}

export type FnolRiskFlags = {
  unauthorizedDriver: boolean;
  youngDriver: { triggered: boolean; age?: number | null; recommendedLoadingPct?: number } | null;
  licenseSurcharge: { triggered: boolean; yearsHeld?: number | null } | null;
  seniorDriver: { triggered: boolean; age?: number | null } | null;
  highValueVehicle: { triggered: boolean; valueEUR?: number | null } | null;
  policeMissingForTheft: boolean;
  requiresReferral: boolean;
  notes: string[];
};

export function computeFnolRiskFlags(input: {
  fnol: unknown;
  policyQuoteData?: unknown;
  namedDrivers?: Array<{ id: string; name: string }>;
}): FnolRiskFlags {
  const fnol = asRecord(input.fnol);
  const policyQd = asRecord(input.policyQuoteData);
  const incident = asRecord(fnol.incident);
  const driver = asRecord(fnol.driver);
  const vehicle = asRecord(fnol.vehicle);
  const police = asRecord(fnol.police);

  const namedDrivers = Array.isArray(input.namedDrivers) ? input.namedDrivers : [];
  const namedDriverId = asString(driver.namedDriverId);
  const driverName = asString(driver.name).toLowerCase();
  const isNamedDriver = Boolean(driver.isNamedDriver);
  const namedMatch = namedDrivers.some((d) =>
    asString(d.id) === namedDriverId || asString(d.name).toLowerCase() === driverName
  );
  const hasDriverIdentity = Boolean(namedDriverId || driverName);
  const unauthorizedDriver = hasDriverIdentity ? !(isNamedDriver && namedMatch) : false;

  const age = ageFromDob(driver.dob);
  const yearsHeld = asNumber(asRecord(driver.license).yearsHeld);
  const vehicleValue = asNumber(vehicle.valueEUR ?? policyQd.vehicleValue ?? policyQd.vehicleValueEur);
  const incidentType = asString(incident.type).toLowerCase();

  const youngDriver = age !== null && age < 25
    ? { triggered: true, age, recommendedLoadingPct: age < 21 ? 180 : 120 }
    : null;
  const seniorDriver = age !== null && age >= 80 ? { triggered: true, age } : null;
  const licenseSurcharge = yearsHeld !== null && yearsHeld < 2 ? { triggered: true, yearsHeld } : null;
  const highValueVehicle = vehicleValue !== null && vehicleValue > 30000 ? { triggered: true, valueEUR: vehicleValue } : null;
  const policeMissingForTheft = incidentType.includes('theft') && police.involved !== true;

  const notes: string[] = [];
  if (unauthorizedDriver) notes.push('Driver not listed on policy');
  if (youngDriver) notes.push(`Young driver (${youngDriver.age})`);
  if (licenseSurcharge) notes.push(`Short license history (${licenseSurcharge.yearsHeld}y)`);
  if (seniorDriver) notes.push(`Senior driver (${seniorDriver.age})`);
  if (highValueVehicle) notes.push(`High-value vehicle (€${Math.round(highValueVehicle.valueEUR || 0)})`);
  if (policeMissingForTheft) notes.push('Theft claim without police involvement');

  const requiresReferral = Boolean(
    unauthorizedDriver ||
    (youngDriver?.age !== undefined && youngDriver.age < 21) ||
    highValueVehicle ||
    policeMissingForTheft
  );

  return {
    unauthorizedDriver,
    youngDriver,
    licenseSurcharge,
    seniorDriver,
    highValueVehicle,
    policeMissingForTheft,
    requiresReferral,
    notes,
  };
}
