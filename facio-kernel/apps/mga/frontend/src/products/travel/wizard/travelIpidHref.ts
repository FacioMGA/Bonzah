/** A missing trip type must never link to a different Travel disclosure. */
export function travelIpidHref(planType: unknown): string | undefined {
  return planType === 'single_trip' || planType === 'annual_multi_trip'
    ? `/api/public/ipid/travel?variant=${planType}`
    : undefined;
}
