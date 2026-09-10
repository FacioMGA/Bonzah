type HomeUsage = { permanentHome?: boolean };

export const HOME_HOLIDAY_UNOCCUPIED_INSPECTION_ENDORSEMENT = {
  code: 'AB105',
  title: 'Unoccupied Property Inspection',
  body: 'It is a condition precedent to liability that, whenever the Home/Holiday Home is left unoccupied, it is inspected at least once every 14 days by You or a person designated by You who has keys to the premises. You must advise us immediately of any loss, damage or circumstance that may give rise to a claim found during an inspection. If a loss, damage or potential claim is discovered and not disclosed to us, no indemnity will be provided for that loss, damage or claim.',
} as const;

/** `usage.permanentHome` is the canonical Home classification used by rating. */
export function requiresHolidayHomeInspectionEndorsement(usage: HomeUsage): boolean {
  return usage.permanentHome === false;
}
