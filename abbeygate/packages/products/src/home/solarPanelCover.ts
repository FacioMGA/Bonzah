/**
 * Canonical Home solar-panel cover rule.
 *
 * Peter's 21 August 2026 product instruction: Cyprus and Greece Home
 * policies include €2,000 solar-panel cover. The amount may be increased,
 * but must not be reduced or removed in those territories.
 */
export const HOME_SOLAR_PANEL_DEFAULT_AMOUNT = 2_000;
/** The first calculator release that prices the mandatory CY/GR minimum. */
export const HOME_SOLAR_PANEL_DEFAULT_CALCULATOR_VERSION = 'home-xlsx-2022@1.4.0';

const HOME_SOLAR_PANEL_DEFAULT_JURISDICTIONS = new Set(['CY', 'GR']);

export function hasHomeSolarPanelDefault(countryCode: unknown): boolean {
  return HOME_SOLAR_PANEL_DEFAULT_JURISDICTIONS.has(String(countryCode ?? '').trim().toUpperCase());
}

/** Resolves the product minimum while preserving a higher selected amount. */
export function resolveHomeSolarPanelCoverAmount(countryCode: unknown, requestedAmount: unknown): number {
  const parsedAmount = Number(requestedAmount);
  const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
  return hasHomeSolarPanelDefault(countryCode)
    ? Math.max(HOME_SOLAR_PANEL_DEFAULT_AMOUNT, amount)
    : amount;
}

/**
 * Documents must use the price snapshot, rather than today's product rule,
 * when reconstructing cover. This keeps a pre-1.4 issued policy unchanged.
 */
export function wasHomeSolarPanelMinimumRated(calculatorVersion: unknown): boolean {
  const match = String(calculatorVersion ?? '').trim().match(/^home-xlsx-2022@(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [, major, minor, patch] = match;
  const actual = [Number(major), Number(minor), Number(patch)];
  const introduced = [1, 4, 0];
  return actual.some((part, index) => part !== introduced[index])
    ? actual[0] > introduced[0]
      || (actual[0] === introduced[0] && actual[1] > introduced[1])
      || (actual[0] === introduced[0] && actual[1] === introduced[1] && actual[2] >= introduced[2])
    : true;
}
