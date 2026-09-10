export const TRAVEL_DESTINATION_AREAS = [
  {
    value: 'europe',
    label: 'Europe',
    areaOfCover: 'Europe',
  },
  {
    value: 'worldwide_excluding_usa_canada',
    label: 'Worldwide excluding the USA and Canada',
    areaOfCover: 'Worldwide excl',
  },
  {
    value: 'worldwide_including_usa_canada',
    label: 'Worldwide including the USA and Canada',
    areaOfCover: 'WorldwideInc',
  },
] as const;

export type TravelDestinationAreaValue = typeof TRAVEL_DESTINATION_AREAS[number]['value'];

export function isTravelDestinationArea(value: string): value is TravelDestinationAreaValue {
  return TRAVEL_DESTINATION_AREAS.some((area) => area.value === value);
}

export function travelDestinationAreaLabel(value: string): string | null {
  return TRAVEL_DESTINATION_AREAS.find((area) => area.value === value)?.label ?? null;
}
