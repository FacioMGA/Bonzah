type Trip = {
  pickupState: string;
  residenceState: string;
  location: string;
  start: string;
  end: string;
  startTime: string;
  endTime: string;
};

/** Preserve the selected pickup wall time in its actual timezone, including DST. */
export function rentalInstant(date: string, time: string, state: string) {
  const zone = (
    { CO: 'America/Denver', CA: 'America/Los_Angeles', NY: 'America/New_York' } as Record<
      string,
      string
    >
  )[state];
  if (!zone) throw new Error('Choose a supported pickup timezone.');
  const wall = Date.parse(`${date}T${time}:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
    );
    const projected = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    instant += wall - projected;
  }
  const offset = (wall - instant) / 60000;
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${date}T${time}:00${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
export function rentalPrefill(trip: Trip): Record<string, unknown> {
  return {
    'pickup.country': 'US',
    'pickup.state': trip.pickupState,
    'pickup.location': trip.location,
    'return.country': 'US',
    'return.state': trip.pickupState,
    'return.location': trip.location,
    'proposer.address.country': 'US',
    'proposer.address.state': trip.residenceState,
    'policy.startDate': trip.start,
    'policy.endDate': trip.end,
    'policy.startAt': rentalInstant(trip.start, trip.startTime, trip.pickupState),
    'policy.endAt': rentalInstant(trip.end, trip.endTime, trip.pickupState),
  };
}
