import type { RentalBindRequest, RentalCoverageCode, RentalQuoteRequest } from '@facio/products';
import type { InsillionJson } from '../infra/insillionClient.js';

const US_STATES: Record<string, string> = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', DC:'District of Columbia',
};

export function insillionDate(value: string, withTime = false, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid rental date.');
  // Birthdays are calendar dates, not instants. Without a booking timezone,
  // preserve the explicit wall date/time in the canonical ISO input.
  if (!timeZone || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(value);
    if (!match) throw new Error('Expected an ISO rental date.');
    return `${match[2]}/${match[3]}/${match[1]}${withTime ? ` ${match[4] || '00'}:${match[5] || '00'}:${match[6] || '00'}` : ''}`;
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (name: string) => parts.find((entry) => entry.type === name)?.value || '';
  return `${part('month')}/${part('day')}/${part('year')}${withTime ? ` ${part('hour')}:${part('minute')}:${part('second')}` : ''}`;
}

function dropOffTime(start: string, end: string, timeZone?: string): string {
  return insillionDate(end, true, timeZone).slice(11) > insillionDate(start, true, timeZone).slice(11) ? 'Later' : 'Same';
}

export function insillionState(code: string): string {
  return US_STATES[code.toUpperCase()] || code;
}

export function coverageFlags(coverages: RentalCoverageCode[]): Pick<InsillionJson, 'cdw_cover'|'rcli_cover'|'sli_cover'|'pai_cover'> {
  return { cdw_cover: coverages.includes('CDW'), rcli_cover: coverages.includes('RCLI'), sli_cover: coverages.includes('SLI'), pai_cover: coverages.includes('PAI_PEI') };
}

export function toInsillionPremium(request: RentalQuoteRequest): InsillionJson {
  return {
    trip_start_date: insillionDate(request.risk.rentalStart), trip_end_date: insillionDate(request.risk.rentalEnd),
    pickup_country: 'United States', pickup_state: insillionState(request.risk.pickup.state),
    drop_off_time: dropOffTime(request.risk.rentalStart, request.risk.rentalEnd),
    ...coverageFlags(request.coverages), skip_validation: false,
  };
}

export function toInsillionFinalQuote(request: RentalQuoteRequest, bind: RentalBindRequest): InsillionJson {
  const flags = coverageFlags(request.coverages);
  if (flags.cdw_cover && !bind.inspectionRecipient) throw new Error('inspectionRecipient is required when CDW is selected.');
  if (!bind.policyBookingTimeZone) throw new Error('policyBookingTimeZone is required for Insillion binding.');
  new Intl.DateTimeFormat('en-US', { timeZone: bind.policyBookingTimeZone });
  const listedDrivers = request.risk.driver.additionalDrivers?.length || 0;
  if ((request.risk.driver.additionalDriversListed && !bind.additionalDrivers?.length) || (listedDrivers > 0 && bind.additionalDrivers?.length !== listedDrivers)) throw new Error('Complete additional driver details are required for every listed driver.');
  const phone = bind.policyholder.phone.replace(/\D/g, '');
  if (!/^\d{11}$/.test(phone)) throw new Error('policyholder phone must contain 11 digits for Insillion.');
  return {
    quote_id: '', trip_start_date: insillionDate(request.risk.rentalStart, true, bind.policyBookingTimeZone), trip_end_date: insillionDate(request.risk.rentalEnd, true, bind.policyBookingTimeZone),
    pickup_country: 'United States', pickup_state: insillionState(request.risk.pickup.state),
    drop_off_time: dropOffTime(request.risk.rentalStart, request.risk.rentalEnd, bind.policyBookingTimeZone),
    residence_country: 'United States', residence_state: insillionState(request.risk.residence.state), ...flags,
    first_name: bind.policyholder.firstName, last_name: bind.policyholder.lastName,
    dob: insillionDate(bind.policyholder.dateOfBirth), pri_email_address: bind.policyholder.email,
    alt_email_address: bind.alternateEmail || '', address_line_1: bind.policyholder.address.line1,
    address_line_2: bind.policyholder.address.line2 || '', zip_code: bind.policyholder.address.postalCode,
    inspection_done: bind.inspectionRecipient || '', source: 'API', phone_no: phone,
    licence_no: bind.policyholder.licence.number, drivers_license_state: insillionState(bind.policyholder.licence.state),
    year: request.risk.vehicle.year, make: request.risk.vehicle.make, model: request.risk.vehicle.model,
    vehicle_class: request.risk.vehicle.class.toUpperCase(),
    ev_classification: request.risk.vehicle.powertrain === 'ev' ? 'Yes' : request.risk.vehicle.powertrain === 'hybrid' ? 'Hybrid' : 'No',
    rental_use: 'Pleasure/Personal',
    additional_drivers: (bind.additionalDrivers || []).map((driver) => ({ first_name: driver.firstName, last_name: driver.lastName, email: driver.email, dob: insillionDate(driver.dateOfBirth), phone_no: driver.phone })),
    policy_booking_time_zone: bind.policyBookingTimeZone, finalize: 1,
  };
}

export function providerData(payload: InsillionJson): InsillionJson {
  return payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data as InsillionJson : {};
}
