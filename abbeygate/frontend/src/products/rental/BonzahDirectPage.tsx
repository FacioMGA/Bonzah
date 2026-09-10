import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, X } from 'lucide-react';
import type { RentalBindRequest, RentalBindResponse, RentalCoverageCode, RentalPowertrain, RentalPricePreviewRequest, RentalPricePreviewResponse, RentalQuoteRequest, RentalQuoteResponse, RentalRepairProfile, RentalVehicleClass, SummitVehicle } from '@facio/products';
import { Button, Checkbox, Input, Select } from '@/src/shared/ui';
import { requestDemoApi } from './demoApi';
import { buildKernelRentalEntryUrl } from './kernelHandoff';

const states = [{ code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' }, { code: 'NY', name: 'New York' }];
const stateName = (code: string) => states.find((item) => item.code === code)?.name ?? code;
const stateCodeFromName = (name: string | null): string | undefined => (name ? states.find((item) => item.name.toLowerCase() === name.toLowerCase())?.code : undefined);
const BONZAH_STEP_PATHS: Record<number, string> = { 1: '/bonzah', 2: '/bonzah/quote/coverages', 3: '/bonzah/quote/renter-and-vehicle', 4: '/bonzah/quote/payment', 5: '/bonzah/quote/confirmation' };
const bonzahStepFromPath = (pathname: string): number => { const match = Object.entries(BONZAH_STEP_PATHS).find(([, path]) => path === pathname); return match ? Number(match[0]) : 1; };
const coverageNames: Record<RentalCoverageCode, string> = { CDW: 'Collision Damage Waiver', RCLI: "Renter's Contingent Liability", SLI: 'Supplemental Liability', PAI_PEI: 'Personal Accident / Effects' };
const ratingVehicle = (selected: SummitVehicle) => ({ id: selected.id, year: selected.year, make: selected.make, model: selected.model, class: selected.class, declaredValue: selected.declaredValue, repairProfile: selected.repairProfile, powertrain: selected.powertrain });
const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const formatTripDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const formatTripTime = (time: string) => { const [hours, minutes] = time.split(':').map(Number); return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
const oneHourLater = (time: string) => { const [hours, minutes] = time.split(':').map(Number); return `${String((hours + 1) % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`; };
const isoDate = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
function CalendarMonth({ year, month, start, end, onSelect }: { year: number; month: number; start: string; end: string; onSelect: (value: string) => void }) {
  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  return <div className="min-w-0 flex-1">
    <h3 className="mb-5 text-center text-lg font-black">{monthName}</h3>
    <div className="grid grid-cols-7 text-center text-[10px] font-black uppercase tracking-wider text-slate-400">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="mt-2 grid grid-cols-7 gap-y-1">{cells.map((day, index) => {
      if (!day) return <span key={`blank-${index}`} />;
      const value = isoDate(year, month, day);
      const isStart = value === start;
      const isEnd = value === end;
      const isEdge = isStart || isEnd;
      const isRange = Boolean(end && value > start && value < end);
      const edgeShape = isStart && isEnd ? 'rounded-xl' : isStart ? 'rounded-l-xl' : 'rounded-r-xl';
      return <Button key={value} variant="link" size="none" aria-label={new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { dateStyle: 'long' })} onClick={() => onSelect(value)} className={`h-11 w-full text-sm font-black ${isEdge ? `bg-[#1d1e29] text-white hover:bg-[#1d1e29] ${edgeShape}` : isRange ? 'bg-[#f8edf3] text-[#1d1e29] hover:bg-[#f0d5e3]' : 'hover:bg-slate-100'}`}>{day}</Button>;
    })}</div>
  </div>;
}
const blankVehicle = { year: '2025', make: 'Toyota', model: 'Camry' };
const VEHICLE_CATALOG: Record<string, { class: RentalVehicleClass; powertrain: RentalPowertrain; repairProfile: RentalRepairProfile; baseValue: number }> = {
  'toyota camry': { class: 'sedan', powertrain: 'combustion', repairProfile: 'standard', baseValue: 29000 },
  'toyota corolla': { class: 'compact', powertrain: 'combustion', repairProfile: 'low', baseValue: 23000 },
  'toyota rav4': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 31000 },
  'toyota highlander': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 39000 },
  'toyota prius': { class: 'compact', powertrain: 'hybrid', repairProfile: 'standard', baseValue: 28000 },
  'honda civic': { class: 'compact', powertrain: 'combustion', repairProfile: 'low', baseValue: 24000 },
  'honda accord': { class: 'sedan', powertrain: 'combustion', repairProfile: 'standard', baseValue: 30000 },
  'honda cr-v': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 32000 },
  'ford f-150': { class: 'suv', powertrain: 'combustion', repairProfile: 'high', baseValue: 42000 },
  'ford explorer': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 40000 },
  'ford mustang': { class: 'sedan', powertrain: 'combustion', repairProfile: 'high', baseValue: 38000 },
  'ford escape': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 29000 },
  'chevrolet malibu': { class: 'sedan', powertrain: 'combustion', repairProfile: 'standard', baseValue: 27000 },
  'chevrolet tahoe': { class: 'suv', powertrain: 'combustion', repairProfile: 'high', baseValue: 58000 },
  'chevrolet equinox': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 28000 },
  'jeep wrangler': { class: 'suv', powertrain: 'combustion', repairProfile: 'high', baseValue: 36000 },
  'jeep grand cherokee': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 39000 },
  'nissan altima': { class: 'sedan', powertrain: 'combustion', repairProfile: 'standard', baseValue: 27000 },
  'nissan rogue': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 30000 },
  'nissan sentra': { class: 'compact', powertrain: 'combustion', repairProfile: 'low', baseValue: 22000 },
  'hyundai elantra': { class: 'compact', powertrain: 'combustion', repairProfile: 'low', baseValue: 22000 },
  'hyundai tucson': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 29000 },
  'kia sportage': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 28000 },
  'kia soul': { class: 'compact', powertrain: 'combustion', repairProfile: 'low', baseValue: 21000 },
  'bmw 3 series': { class: 'sedan', powertrain: 'combustion', repairProfile: 'high', baseValue: 45000 },
  'mercedes-benz c-class': { class: 'sedan', powertrain: 'combustion', repairProfile: 'high', baseValue: 48000 },
  'tesla model 3': { class: 'sedan', powertrain: 'ev', repairProfile: 'high', baseValue: 42000 },
  'tesla model y': { class: 'suv', powertrain: 'ev', repairProfile: 'high', baseValue: 48000 },
  'subaru outback': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 31000 },
  'volkswagen jetta': { class: 'compact', powertrain: 'combustion', repairProfile: 'standard', baseValue: 24000 },
  'mazda cx-5': { class: 'suv', powertrain: 'combustion', repairProfile: 'standard', baseValue: 30000 },
  'dodge charger': { class: 'sedan', powertrain: 'combustion', repairProfile: 'high', baseValue: 36000 },
  'ram 1500': { class: 'suv', powertrain: 'combustion', repairProfile: 'high', baseValue: 44000 },
};
const LUXURY_MAKES = ['bmw', 'mercedes-benz', 'mercedes', 'audi', 'lexus', 'porsche', 'tesla', 'land rover', 'jaguar', 'cadillac', 'genesis', 'maserati', 'bentley', 'rolls-royce', 'ferrari', 'lamborghini', 'alfa romeo'];
const COMPACT_MODEL_HINTS = /civic|corolla|elantra|sentra|mini|fit|yaris|spark|soul|jetta|versa|mirage|rio|forte/i;
const SUV_MODEL_HINTS = /truck|f-?150|f-?250|silverado|sierra|ram\s?\d|tundra|tacoma|tahoe|suburban|yukon|expedition|explorer|4runner|wrangler|grand cherokee|highlander|pilot|\bsuv\b|xc90|x5|q7|gle|equinox|escape|cr-v|rav4|rogue|tucson|sportage|cx-5|outback|pathfinder|traverse|atlas/i;
const EV_MODEL_HINTS = /model\s?[3sxy]|\bev\b|electric|e-tron|\bbolt\b|\bleaf\b|ioniq|mach-e|\bix\b|taycan|id\.4|ariya/i;
const HYBRID_MODEL_HINTS = /hybrid|prius/i;
function estimateVehicleProfile(year: number, make: string, model: string): { class: RentalVehicleClass; powertrain: RentalPowertrain; repairProfile: RentalRepairProfile; declaredValue: number } {
  const makeLower = make.trim().toLowerCase();
  const modelLower = model.trim().toLowerCase();
  const catalogHit = VEHICLE_CATALOG[`${makeLower} ${modelLower}`];
  const vehicleClass: RentalVehicleClass = catalogHit?.class ?? (SUV_MODEL_HINTS.test(modelLower) ? 'suv' : COMPACT_MODEL_HINTS.test(modelLower) ? 'compact' : 'sedan');
  const powertrain: RentalPowertrain = catalogHit?.powertrain ?? (EV_MODEL_HINTS.test(modelLower) ? 'ev' : HYBRID_MODEL_HINTS.test(modelLower) ? 'hybrid' : 'combustion');
  const isLuxury = LUXURY_MAKES.includes(makeLower);
  const repairProfile: RentalRepairProfile = catalogHit?.repairProfile ?? (isLuxury ? 'high' : vehicleClass === 'compact' ? 'low' : 'standard');
  const baseValue = catalogHit?.baseValue ?? (vehicleClass === 'suv' ? 38000 : vehicleClass === 'compact' ? 23000 : 29000) * (isLuxury ? 1.5 : 1) + (powertrain === 'ev' ? 5000 : 0);
  const age = Math.max(0, new Date().getUTCFullYear() - (Number.isFinite(year) ? year : new Date().getUTCFullYear()));
  const declaredValue = Math.max(9000, Math.round((baseValue * Math.max(0.35, 1 - 0.11 * age)) / 250) * 250);
  return { class: vehicleClass, powertrain, repairProfile, declaredValue };
}

export function BonzahDirectPage() {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const [step, setStep] = useState(() => bonzahStepFromPath(routerLocation.pathname));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trip, setTrip] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      pickupCountry: 'US',
      pickupState: stateCodeFromName(params.get('pickupState')) ?? 'CO',
      location: params.get('pickupLocation') ?? 'Denver International Airport',
      start: params.get('tripStart') ?? '2026-09-18',
      startTime: params.get('pickupTime') ?? '10:00',
      end: params.get('tripEnd') ?? '2026-09-22',
      endTime: params.get('dropoffTime') ?? '10:00',
      residenceCountry: 'US',
      residenceState: stateCodeFromName(params.get('residenceState')) ?? 'CA',
    };
  });
  const [tripDatesOpen, setTripDatesOpen] = useState(false);
  const [driverAge, setDriverAge] = useState('35');
  const [draftTrip, setDraftTrip] = useState(() => ({ start: '2026-09-18', startTime: '10:00', end: '2026-09-22', endTime: '10:00' }));
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [vehicleForm, setVehicleForm] = useState(blankVehicle);
  const [vehicle, setVehicle] = useState<SummitVehicle | null>(null);
  const [rentalCompany, setRentalCompany] = useState('Enterprise Rent-A-Car');
  const [rentalUse, setRentalUse] = useState<RentalQuoteRequest['risk']['rentalUse']>('PERSONAL');
  const [coverages, setCoverages] = useState<RentalCoverageCode[]>(['CDW']);
  const [preview, setPreview] = useState<RentalPricePreviewResponse | null>(null);
  const [quote, setQuote] = useState<RentalQuoteResponse | null>(null);
  const [confirmation, setConfirmation] = useState<RentalBindResponse | null>(null);
  const [person, setPerson] = useState({ firstName: 'Alex', lastName: 'Morgan', dob: '1991-06-15', phone: '+1 555 010 2040', email: 'alex.morgan@example.test', agencyEmail: '', line1: '123 Main Street', line2: '', city: 'Denver', zip: '80202', licenceNumber: 'D0000000', licenceState: 'CA', additional: false, additionalName: '', additionalLicence: '', additionalState: 'CA' });
  const consents = { delivery: true, terms: true, exclusions: true, truthful: true, liability: true };
  const buildTripParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('pickupCountry', 'United States');
    params.set('pickupState', stateName(trip.pickupState));
    params.set('pickupLocation', trip.location);
    params.set('tripStart', trip.start);
    params.set('tripEnd', trip.end);
    params.set('pickupTime', trip.startTime);
    params.set('dropoffTime', trip.endTime);
    params.set('residenceCountry', 'United States');
    params.set('residenceState', stateName(trip.residenceState));
    return params;
  }, [trip]);
  const startQuote = useCallback(() => {
    const parameters = buildTripParams();
    parameters.set('driverAge', driverAge);
    window.location.assign(buildKernelRentalEntryUrl(parameters, { baseUrl: import.meta.env.VITE_BONZAH_KERNEL_PUBLIC_URL }));
  }, [buildTripParams, driverAge]);
  const goToStep = useCallback((nextStep: number) => {
    const savedTrip = nextStep === 1 ? '' : routerLocation.search;
    navigate(`${BONZAH_STEP_PATHS[nextStep]}${savedTrip}`);
    setStep(nextStep);
  }, [navigate, routerLocation.search]);
  useEffect(() => {
    let resolvedStep = bonzahStepFromPath(routerLocation.pathname);
    if (resolvedStep >= 2 && (!vehicle || !preview)) resolvedStep = 1;
    else if (resolvedStep >= 4 && !quote) resolvedStep = 3;
    if (BONZAH_STEP_PATHS[resolvedStep] !== routerLocation.pathname) { navigate(`${BONZAH_STEP_PATHS[resolvedStep]}${routerLocation.search}`, { replace: true }); }
    setStep(resolvedStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerLocation.pathname]);
  const demoPaymentEnabled = import.meta.env.DEV || import.meta.env.VITE_BONZAH_DEMO_ENABLED === 'true';
  const liability = coverages.includes('RCLI') || coverages.includes('SLI');
  const requiredDetails = [person.firstName, person.lastName, person.dob, person.phone, person.email, person.line1, person.city, person.zip, person.licenceNumber, rentalCompany, vehicleForm.year, vehicleForm.make, vehicleForm.model];
  const detailsReady = requiredDetails.every((value) => value.trim()) && Number(vehicleForm.year) >= 2000 && (!person.additional || [person.additionalName, person.additionalLicence].every((value) => value.trim()));
  const periods = useMemo(() => Math.max(1, Math.ceil((Date.parse(`${trip.end}T${trip.endTime}:00Z`) - Date.parse(`${trip.start}T${trip.startTime}:00Z`)) / 86_400_000)), [trip]);
  const vehicleProfilePreview = useMemo(() => (vehicleForm.make.trim() && vehicleForm.model.trim() ? estimateVehicleProfile(Number(vehicleForm.year), vehicleForm.make, vehicleForm.model) : null), [vehicleForm]);

  const risk = (selected: SummitVehicle): RentalQuoteRequest['risk'] => ({ pickup: { country: 'US', state: trip.pickupState, location: trip.location }, residence: { country: 'US', state: trip.residenceState }, rentalStart: `${trip.start}T${trip.startTime}:00Z`, rentalEnd: `${trip.end}T${trip.endTime}:00Z`, driver: { age: person.dob ? Math.max(0, new Date(trip.start).getUTCFullYear() - new Date(person.dob).getUTCFullYear()) : 25, licenceValid: Boolean(person.licenceNumber), additionalDriversListed: person.additional, additionalDrivers: person.additional ? [{ fullName: person.additionalName, licenceNumber: person.additionalLicence, licenceState: person.additionalState }] : undefined }, rentalUse, vehicle: ratingVehicle(selected) });

  const selectRangeDate = (value: string) => {
    if (!rangeAnchor) { setDraftTrip((current) => ({ ...current, start: value, end: '' })); setRangeAnchor(value); return; }
    if (value < rangeAnchor) setDraftTrip((current) => ({ ...current, start: value, end: rangeAnchor }));
    else setDraftTrip((current) => ({ ...current, start: rangeAnchor, end: value }));
    setRangeAnchor(null);
  };

  const chooseVehicle = async () => {
    const year = Number(vehicleForm.year);
    if (!vehicleForm.make.trim() || !vehicleForm.model.trim() || year < 2000) { setError('Enter a valid year, make and model.'); return; }
    const profile = estimateVehicleProfile(year, vehicleForm.make, vehicleForm.model);
    const selected: SummitVehicle = { id: `direct-${crypto.randomUUID()}`, name: 'Direct quote vehicle', category: profile.class, year, make: vehicleForm.make.trim(), model: vehicleForm.model.trim(), class: profile.class, declaredValue: profile.declaredValue, repairProfile: profile.repairProfile, powertrain: profile.powertrain, seats: 5, bags: 2, dailyRentalPrice: 0, availability: 'AVAILABLE', accent: '#f05a3c' };
    setBusy(true); setError('');
    try {
      const request: RentalPricePreviewRequest = { pickup: { country: 'US', state: trip.pickupState }, rentalStart: `${trip.start}T${trip.startTime}:00Z`, rentalEnd: `${trip.end}T${trip.endTime}:00Z`, vehicle: ratingVehicle(selected), coverages };
      setPreview(await requestDemoApi('/price-preview', { method: 'POST', body: JSON.stringify(request) }));
      setVehicle(selected);
      const quoteRequest: RentalQuoteRequest = { programId: 'BONZAH-US-FOUNDATION-2026', channel: 'WEB', effectiveDate: '2026-09-07', risk: risk(selected), coverages };
      const result = await requestDemoApi<RentalQuoteResponse>('/quotes', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(quoteRequest) });
      setQuote(result); if (result.status === 'QUOTED') goToStep(4);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to price this vehicle.'); }
    finally { setBusy(false); }
  };

  const toggleCoverage = async (code: RentalCoverageCode, checked: boolean) => {
    let next = checked ? [...coverages, code] : coverages.filter((item) => item !== code);
    if (code === 'RCLI' && !checked) next = next.filter((item) => item !== 'SLI');
    setCoverages(next); setQuote(null);
    if (!vehicle || !next.length) return;
    setBusy(true);
    try { setPreview(await requestDemoApi('/price-preview', { method: 'POST', body: JSON.stringify({ pickup: { country: 'US', state: trip.pickupState }, rentalStart: `${trip.start}T${trip.startTime}:00Z`, rentalEnd: `${trip.end}T${trip.endTime}:00Z`, vehicle: ratingVehicle(vehicle), coverages: next }) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update the premium.'); }
    finally { setBusy(false); }
  };

  const bind = async () => {
    if (!quote) return;
    setBusy(true); setError('');
    try {
      const request: RentalBindRequest = { integrityToken: quote.integrityToken, expectedTotal: quote.total, payment: { provider: 'SIMULATED', token: `simulated-${quote.quoteId}` }, policyholder: { firstName: person.firstName, lastName: person.lastName, dateOfBirth: person.dob, email: person.email, phone: person.phone, address: { line1: person.line1, line2: person.line2 || undefined, city: person.city, state: trip.residenceState, postalCode: person.zip, country: 'US' }, licence: { number: person.licenceNumber, state: person.licenceState } }, rentalAgreement: { rentalCompany, agencyEmail: person.agencyEmail || undefined }, consents: { electronicDelivery: true, termsAndPrivacyAccepted: true, exclusionsAccepted: true, truthfulnessAccepted: true, liabilityNoticeAccepted: !liability || consents.liability, wordingVersion: 'bonzah-rental-us-2026.1', acceptedAt: new Date().toISOString() } };
      const bindResult = await requestDemoApi<RentalBindResponse>(`/quotes/${quote.quoteId}/bind`, { method: 'POST', headers: { 'Idempotency-Key': `direct-bind-${quote.quoteId}` }, body: JSON.stringify(request) });
      setConfirmation(bindResult); goToStep(5);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to confirm protection.'); }
    finally { setBusy(false); }
  };

  const updatePerson = (key: keyof typeof person, value: string | boolean) => setPerson((current) => ({ ...current, [key]: value }));
  const titles = ['Trip', 'Coverages', 'Renter & vehicle', 'Payment', 'Confirmed'];
  return <main className="brand-route-scroll h-screen overflow-y-auto overflow-x-hidden bg-white text-[#1d1e29]">
    <header className="sticky top-0 z-30 border-b border-[#f2d7e5] bg-white font-['Raleway']"><div className="mx-auto flex h-16 w-[calc(100%-2.5rem)] max-w-[1130px] items-center justify-between"><a href="/bonzah" aria-label="Bonzah home"><img src="https://static.tildacdn.net/tild3433-3032-4665-b235-643337386531/Logo-footerc1ca88f88.svg" alt="Bonzah" className="h-auto w-[150px] max-w-[38vw]" /></a><nav aria-label="Bonzah navigation" className="hidden items-center gap-6 text-sm font-semibold text-[#a01e69] lg:flex"><a className="hover:text-[#e20082]" href="https://bonzah.com/faq">FAQ</a><a className="hover:text-[#e20082]" href="https://us.bonzah.com/#/orders">Download / Manage Policy</a><a className="hover:text-[#e20082]" href="https://bonzah.com/claims">Claims</a><a className="hover:text-[#e20082]" href="https://bonzah.com/about">About Us</a><a className="hover:text-[#e20082]" href="https://bonzah.com/contact">Contact Us</a></nav></div><div className="bg-[#fff8fb]"><div className="mx-auto flex min-h-10 w-[calc(100%-2.5rem)] max-w-[1130px] items-center gap-4 overflow-x-auto py-1.5"><div className="shrink-0"><p className="text-[9px] font-black uppercase tracking-[.18em] text-[#a01e69]">Quote progress</p><p className="text-xs font-black text-[#1d1e29]">{titles[step - 1]}</p></div><nav aria-label="Bonzah quote steps" className="ml-auto flex min-w-max items-center gap-2">{titles.map((title, index) => <span key={title} aria-current={index + 1 === step ? 'step' : undefined} className={`rounded-full px-3 py-1 text-[11px] font-black ${index + 1 === step ? 'bg-[#d32982] text-white' : index + 1 < step ? 'bg-[#f4d5e5] text-[#a01e69]' : 'bg-white text-slate-400'}`}>{index + 1}. {title}</span>)}</nav></div></div></header>
    {tripDatesOpen && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1d1e29]/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setTripDatesOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="bonzah-date-title" className="w-full max-w-4xl overflow-hidden rounded-[28px] bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#f2d7e5] px-6 py-5 md:px-8"><div><p className="text-xs font-black uppercase tracking-[.18em] text-[#d32982]">Select one rental period</p><h2 id="bonzah-date-title" className="mt-1 text-2xl font-black">Pickup and return dates</h2></div><Button variant="ghost" size="sm" aria-label="Close date picker" onClick={() => setTripDatesOpen(false)}><X className="h-5 w-5" /></Button></div><div className="grid gap-8 p-6 md:grid-cols-2 md:p-8"><CalendarMonth year={2026} month={8} start={draftTrip.start} end={draftTrip.end} onSelect={selectRangeDate} /><CalendarMonth year={2026} month={9} start={draftTrip.start} end={draftTrip.end} onSelect={selectRangeDate} /></div><div className="grid gap-4 border-t border-[#f2d7e5] px-6 py-5 md:grid-cols-2 md:px-8"><label className="text-xs font-black uppercase tracking-wide text-slate-500">Pickup time<div className="relative mt-2"><Clock3 className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#d32982]" /><Input aria-label="Pickup time" type="time" value={draftTrip.startTime} onChange={(event) => setDraftTrip({ ...draftTrip, startTime: event.target.value })} className="min-h-[52px] w-full min-w-0 pl-12" /></div></label><label className="text-xs font-black uppercase tracking-wide text-slate-500">Return time<div className="relative mt-2"><Clock3 className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#d32982]" /><Input aria-label="Return time" type="time" value={draftTrip.endTime} onChange={(event) => setDraftTrip({ ...draftTrip, endTime: event.target.value })} className="min-h-[52px] w-full min-w-0 pl-12" /></div></label></div><div className="flex flex-col gap-4 border-t border-[#f2d7e5] bg-[#fff8fb] px-6 py-5 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-3 text-sm"><span className="rounded-xl bg-white px-4 py-2 font-black shadow-sm">{draftTrip.start ? formatTripDate(draftTrip.start) : 'Choose pickup'}</span><ArrowRight className="h-4 w-4 text-slate-400" /><span className="rounded-xl bg-white px-4 py-2 font-black shadow-sm">{draftTrip.end ? formatTripDate(draftTrip.end) : 'Choose return'}</span><span className="hidden text-slate-500 sm:inline">{rangeAnchor ? 'Now choose your return date' : 'One calendar, one continuous range'}</span></div><Button disabled={!draftTrip.start || !draftTrip.end} className="bg-[#d32982] hover:bg-[#a01e69]" onClick={() => { setTrip({ ...trip, ...draftTrip }); setTripDatesOpen(false); }}>Apply rental dates</Button></div></section></div>}
    {step === 1 ? <section className="mx-auto grid w-[calc(100%-2.5rem)] max-w-[1130px] gap-6 pb-6 pt-4 font-['Raleway'] lg:grid-cols-[420px_minmax(0,1fr)]">
      <div className="rounded-[24px] bg-[#d32982] px-6 py-6 text-white sm:px-9 sm:py-7">
        <div className="space-y-2.5">
          <label className="block text-sm font-normal leading-5">Rental car pickup State:
            <Select aria-label="Rental car pickup State" className="mt-1 h-11 rounded-xl border-0 bg-[#f8e5ee] px-4 text-sm font-normal text-[#78566a] shadow-none focus:!border-white" value={trip.pickupState} onChange={(event) => setTrip({ ...trip, pickupState: event.target.value })}>{states.map((state) => <option key={state.code} value={state.code}>{state.name}</option>)}</Select>
          </label>
          <div className="text-sm font-normal leading-5">When does your trip start?
            <Button aria-label="Choose pickup and return dates" variant="secondary" className="mt-1 min-h-11 w-full justify-between rounded-xl border-0 bg-[#f8e5ee] px-4 text-left text-sm text-[#78566a] shadow-none hover:bg-[#f8e5ee]" onClick={() => { setDraftTrip({ start: trip.start, startTime: trip.startTime, end: trip.end, endTime: trip.endTime }); setRangeAnchor(null); setTripDatesOpen(true); }}><span className="font-normal">{formatTripDate(trip.start)} · {formatTripTime(trip.startTime)}</span><CalendarDays className="h-5 w-5 shrink-0" /></Button>
          </div>
          <div className="text-sm font-normal leading-5">When does your trip end?
            <Button aria-label="Edit pickup and return dates" variant="secondary" className="mt-1 min-h-11 w-full justify-between rounded-xl border-0 bg-[#f8e5ee] px-4 text-left text-sm text-[#78566a] shadow-none hover:bg-[#f8e5ee]" onClick={() => { setDraftTrip({ start: trip.start, startTime: trip.startTime, end: trip.end, endTime: trip.endTime }); setRangeAnchor(null); setTripDatesOpen(true); }}><span className="font-normal">{formatTripDate(trip.end)} · {formatTripTime(trip.endTime)}</span><CalendarDays className="h-5 w-5 shrink-0" /></Button>
          </div>
          <fieldset className="pt-0.5"><legend className="text-sm font-normal leading-5">The rental car drop off time</legend><p className="mt-1 text-[11px] leading-[1.2] text-white/90">Policies are sold in 24-hour increments. If your drop off exceeds 24 hours from pickup, select &quot;Later&quot;.</p><div className="mt-2 flex items-center gap-5"><Button type="button" variant="link" aria-pressed={trip.endTime === trip.startTime} className="gap-2 text-sm font-normal text-white" onClick={() => setTrip({ ...trip, endTime: trip.startTime })}><span className={`grid h-5 w-5 place-items-center rounded-full border-2 border-white ${trip.endTime === trip.startTime ? 'before:h-2.5 before:w-2.5 before:rounded-full before:bg-white' : ''}`} />Same</Button><Button type="button" variant="link" aria-pressed={trip.endTime !== trip.startTime} className="gap-2 text-sm font-normal text-white" onClick={() => setTrip({ ...trip, endTime: trip.endTime === trip.startTime ? oneHourLater(trip.startTime) : trip.endTime })}><span className={`grid h-5 w-5 place-items-center rounded-full border-2 border-white ${trip.endTime !== trip.startTime ? 'before:h-2.5 before:w-2.5 before:rounded-full before:bg-white' : ''}`} />Later</Button></div></fieldset>
          <label className="block text-sm font-normal leading-5">Country of Residence
            <Select aria-label="Country of Residence" className="mt-1 h-11 rounded-xl border-0 bg-[#f8e5ee] px-4 text-sm font-normal text-[#78566a] shadow-none" value="US" disabled><option value="US">United States</option></Select>
          </label>
          <label className="block text-sm font-normal leading-5">State of Residence
            <Select aria-label="State of Residence" className="mt-1 h-11 rounded-xl border-0 bg-[#f8e5ee] px-4 text-sm font-normal text-[#78566a] shadow-none focus:!border-white" value={trip.residenceState} onChange={(event) => setTrip({ ...trip, residenceState: event.target.value })}>{states.map((state) => <option key={state.code} value={state.code}>{state.name}</option>)}</Select>
          </label>
          <label className="block text-sm font-normal leading-5">Driver age
            <Input aria-label="Driver age" type="number" min="21" max="100" className="mt-1 h-11 rounded-xl border-0 bg-[#f8e5ee] px-4 text-sm font-normal text-[#78566a] shadow-none" value={driverAge} onChange={(event) => setDriverAge(event.target.value)} />
          </label>
        </div>
        <Button className="mt-4 min-h-11 w-full rounded-xl bg-[#1d1e29] text-sm font-semibold hover:bg-[#31323f]" disabled={busy} onClick={startQuote}>Get my quote</Button>
      </div>
      <div className="flex flex-col overflow-hidden rounded-[24px] bg-[#fbf0f6] px-8 pb-5 pt-6 text-[#1d1e29] sm:px-9 sm:pt-7">
        <h1 className="max-w-[520px] text-[28px] font-medium leading-[1.15] tracking-[-.03em] sm:text-[36px]">Affordable,<br />Complete Protection<br />for <span className="text-[#d32982]">Your Rental Car</span></h1>
        <p className="mt-3 max-w-[520px] text-sm font-normal leading-[1.4] sm:text-base">Unlock That Covered Feeling™ with reliable rental vehicle damage and 3rd party liability coverage for your rental car at a fraction of the cost. Get an instant quote to see how much you can save.</p>
        <img src="https://static.tildacdn.net/tild3039-3338-4330-b162-633266623662/Group_79406.svg" alt="Bonzah rental car illustration" className="mx-auto mt-4 hidden w-full max-w-[220px] sm:block" />
      </div>
    </section> : <section className="mx-auto max-w-5xl px-5 py-10"><div className="mb-8"><Button variant="ghost" onClick={() => goToStep(Math.max(1, step - 1))}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></div>{error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {step === 3 && <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start"><div className="rounded-3xl bg-white p-7 shadow-sm"><h1 className="text-3xl font-black">Tell us about your rental and drivers</h1><p className="mt-2 text-slate-600">Now add the renter, driver, and vehicle details. We’ll confirm the final price using the coverages you selected.</p>
        <section className="mt-8"><div className="border-b border-[#f2d7e5] pb-3"><p className="text-xs font-black uppercase tracking-[.16em] text-[#d32982]">Rental details</p><h2 className="mt-1 text-xl font-black">About the rental vehicle</h2></div><div className="mt-5 grid gap-5 md:grid-cols-2"><label className="text-sm font-bold">Rental company*<Input className="mt-2" value={rentalCompany} onChange={(e) => setRentalCompany(e.target.value)} /></label><label className="text-sm font-bold">Rental use<Select className="mt-2" value={rentalUse} onChange={(e) => setRentalUse(e.target.value as typeof rentalUse)}><option value="PERSONAL">Personal / leisure</option><option value="COMMERCIAL">Commercial</option><option value="RIDESHARE_OR_DELIVERY">Rideshare / delivery</option></Select></label><label className="text-sm font-bold">Year*<Input className="mt-2" type="number" value={vehicleForm.year} onChange={(e) => setVehicleForm({ ...vehicleForm, year: e.target.value })} /></label><label className="text-sm font-bold">Make*<Input className="mt-2" placeholder="e.g. Toyota" value={vehicleForm.make} onChange={(e) => setVehicleForm({ ...vehicleForm, make: e.target.value })} /></label><label className="text-sm font-bold md:col-span-2">Model*<Input className="mt-2" placeholder="e.g. Camry" value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} /></label></div>{vehicleProfilePreview && <p className="mt-4 rounded-2xl bg-[#fff8fb] p-4 text-sm text-slate-600">We’ll rate this as a <strong className="text-[#1d1e29]">{vehicleProfilePreview.class}</strong> with an estimated value of <strong className="text-[#1d1e29]">{usd(vehicleProfilePreview.declaredValue)}</strong>. You can change these details before payment.</p>}</section>
        <section className="mt-9"><div className="border-b border-[#f2d7e5] pb-3"><p className="text-xs font-black uppercase tracking-[.16em] text-[#d32982]">Policyholder</p><h2 className="mt-1 text-xl font-black">Renter information</h2></div><div className="mt-5 grid gap-5 md:grid-cols-2">{([['firstName','First name'],['lastName','Last name'],['dob','Date of birth'],['phone','Phone'],['email','Email'],['agencyEmail','Rental agency email (optional)'],['line1','Address line 1'],['line2','Address line 2 (optional)'],['city','City'],['zip','ZIP code']] as const).map(([key,label]) => <label key={key} className="text-sm font-bold">{label}{!label.includes('optional') && '*'}<Input className="mt-2" type={key === 'dob' ? 'date' : key.includes('email') || key === 'agencyEmail' ? 'email' : 'text'} value={String(person[key])} onChange={(e) => updatePerson(key,e.target.value)} /></label>)}</div></section>
        <section className="mt-9"><div className="border-b border-[#f2d7e5] pb-3"><p className="text-xs font-black uppercase tracking-[.16em] text-[#d32982]">On the rental agreement</p><h2 className="mt-1 text-xl font-black">Driver information</h2></div><div className="mt-5 grid gap-5 md:grid-cols-2"><label className="text-sm font-bold">Driver licence number*<Input className="mt-2" value={person.licenceNumber} onChange={(e) => updatePerson('licenceNumber',e.target.value)} /></label><label className="text-sm font-bold">Licence state<Select className="mt-2" value={person.licenceState} onChange={(e) => updatePerson('licenceState',e.target.value)}>{states.map((state)=><option key={state.code} value={state.code}>{state.name}</option>)}</Select></label><div className="md:col-span-2 rounded-2xl border p-4"><Checkbox label="Add an additional driver" checked={person.additional} onChange={(e) => updatePerson('additional',e.target.checked)} />{person.additional && <div className="mt-4 grid gap-4 md:grid-cols-3"><Input aria-label="Additional driver full name" placeholder="Full name" value={person.additionalName} onChange={(e)=>updatePerson('additionalName',e.target.value)} /><Input aria-label="Additional driver licence number" placeholder="Licence number" value={person.additionalLicence} onChange={(e)=>updatePerson('additionalLicence',e.target.value)} /><Select aria-label="Additional driver licence state" value={person.additionalState} onChange={(e)=>updatePerson('additionalState',e.target.value)}>{states.map((state)=><option key={state.code} value={state.code}>{state.name}</option>)}</Select></div>}</div></div></section>
      </div><aside className="overflow-hidden rounded-[28px] bg-white shadow-[0_22px_60px_rgba(136,15,80,.12)] lg:sticky lg:top-44"><div className="border-b border-[#f2d7e5] p-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Your trip</p><h2 className="mt-1 font-black">{trip.location}</h2><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="font-bold text-slate-400">PICK-UP</p><p className="mt-1 font-black">{formatTripDate(trip.start)}</p><p>{formatTripTime(trip.startTime)}</p></div><div><p className="font-bold text-slate-400">RETURN</p><p className="mt-1 font-black">{formatTripDate(trip.end)}</p><p>{formatTripTime(trip.endTime)}</p></div></div></div><div className="border-b border-[#f2d7e5] p-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Your selected protection</p><div className="mt-2 divide-y divide-[#f2d7e5]">{coverages.map((code) => <div key={code} className="flex items-center gap-2 py-2 text-xs"><Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" /><p className="font-bold">{coverageNames[code]}</p></div>)}</div><Button variant="link" className="mt-2 px-0 text-xs font-bold text-[#d32982]" onClick={() => goToStep(2)}>Edit coverages</Button></div><div className="p-5"><p className="text-sm text-slate-600">We’ll recalculate your selected protection for the vehicle you enter before showing payment.</p><Button className="mt-5 min-h-12 w-full bg-[#d32982]" disabled={!detailsReady || busy} onClick={chooseVehicle}>Continue to payment</Button></div></aside></div>}
      {step === 2 && preview && <div><h1 className="text-3xl font-black">Choose your protection</h1><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start"><div className="grid gap-4 sm:grid-cols-2">{(['CDW','RCLI','SLI','PAI_PEI'] as RentalCoverageCode[]).map((code) => { const price = preview.coverages.find((item) => item.code === code)!; const selected = coverages.includes(code); const disabled = code === 'SLI' && !coverages.includes('RCLI'); return <article key={code} className={`rounded-2xl border-2 bg-white p-5 ${selected ? 'border-[#d32982]' : 'border-transparent'}`}><Checkbox label={<strong>{coverageNames[code]}{disabled ? ' · Requires RCLI' : ''}</strong>} checked={selected} disabled={disabled || busy} onChange={(e) => void toggleCoverage(code, e.target.checked)} /><p className="mt-4 text-xl font-black">{usd(price.dailyPrice)}/day</p><p className="mt-1 text-sm">{usd(price.tripPrice)} for {periods} charged periods</p><p className="mt-3 text-sm text-slate-600">Limit {price.limit} · Deductible {price.deductible}</p><p className="mt-2 text-sm text-slate-600">{price.description}</p></article>; })}</div>
        <aside className="overflow-hidden rounded-[28px] bg-white shadow-[0_22px_60px_rgba(136,15,80,.12)] lg:sticky lg:top-28">
          <div className="border-b border-[#f2d7e5] p-5"><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Product</p><h2 className="mt-1 font-black">Your protection</h2>
            <div className="mt-3 divide-y divide-[#f2d7e5]">{(['CDW','RCLI','SLI','PAI_PEI'] as RentalCoverageCode[]).map((code) => { const price = preview.coverages.find((item) => item.code === code)!; const selected = coverages.includes(code); return <div key={code} className="flex items-center justify-between gap-3 py-3 text-xs"><div className="min-w-0"><p className={`font-bold ${selected ? 'text-[#1d1e29]' : 'text-slate-400'}`}>{coverageNames[code]}</p><p className="mt-0.5 text-[10px] text-slate-400">{preview.chargedPeriods} days x 24 hours x {usd(price.dailyPrice)}</p></div><strong className={`shrink-0 tabular-nums ${selected ? 'text-[#d32982]' : 'text-slate-300'}`}>{usd(selected ? price.tripPrice : 0)}</strong></div>; })}</div>
          </div>
          <div className="p-5">
            <div className="flex items-end justify-between border-t border-[#f2d7e5] pt-3"><div><p className="text-[10px] font-bold text-slate-400">TOTAL DUE NOW</p><p className="text-[10px] text-slate-500">USD</p></div><strong className="text-3xl tracking-tight">{usd(preview.subtotal)}</strong></div>
            <Button className="mt-5 min-h-12 w-full bg-[#d32982]" disabled={!coverages.length || busy} onClick={() => goToStep(3)}>Continue to renter details</Button>
          </div>
        </aside>
      </div></div>}
      {step === 4 && quote && <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start"><div className="rounded-3xl bg-white p-7 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.16em] text-[#d32982]">Checkout</p><h1 className="mt-1 text-3xl font-black">Secure payment</h1><p className="mt-2 text-sm text-slate-600">Complete your purchase using a major card or supported wallet.</p></div></div>{demoPaymentEnabled ? <><div className="mt-7 grid gap-3 sm:grid-cols-2"><Button variant="secondary" className="min-h-12 border border-slate-200 bg-black font-black text-white hover:bg-slate-800" onClick={bind} disabled={busy}> Pay</Button><Button variant="secondary" className="min-h-12 border border-slate-200 bg-white font-black text-[#4285f4] hover:bg-slate-50" onClick={bind} disabled={busy}>G Pay</Button></div><div className="my-6 flex items-center gap-3 text-xs font-black uppercase tracking-[.16em] text-slate-400"><span className="h-px flex-1 bg-slate-200" />Or pay with card<span className="h-px flex-1 bg-slate-200" /></div><div className="grid gap-5"><label className="text-sm font-bold">Card information<div className="mt-2 overflow-hidden rounded-xl border border-slate-200"><Input aria-label="Card number" inputMode="numeric" autoComplete="cc-number" placeholder="1234 1234 1234 1234" className="rounded-none border-0 border-b" /><div className="grid grid-cols-2"><Input aria-label="Expiration date" inputMode="numeric" autoComplete="cc-exp" placeholder="MM / YY" className="rounded-none border-0 border-r" /><Input aria-label="Security code" inputMode="numeric" autoComplete="cc-csc" placeholder="CVC" className="rounded-none border-0" /></div></div><span className="mt-2 block text-xs font-semibold text-slate-400">VISA · Mastercard · AMEX</span></label><label className="text-sm font-bold">Name on card<Input aria-label="Name on card" autoComplete="cc-name" className="mt-2" placeholder={`${person.firstName} ${person.lastName}`} /></label><label className="text-sm font-bold">Billing ZIP code<Input aria-label="Billing ZIP code" autoComplete="postal-code" className="mt-2" placeholder={person.zip} /></label></div><Button className="mt-6 min-h-12 w-full bg-[#d32982]" disabled={busy} onClick={bind}>Pay {usd(quote.total)} · Demo</Button></> : <div className="mt-7 rounded-2xl border p-5"><strong>Hosted payment required</strong><p className="mt-2 text-sm text-slate-600">Configure Bonzah’s approved hosted payment component before accepting live payment details.</p></div>}</div>
        <aside className="overflow-hidden rounded-[28px] bg-white shadow-[0_22px_60px_rgba(136,15,80,.12)] lg:sticky lg:top-44"><div className="border-b border-[#f2d7e5] p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Order summary</p><h2 className="mt-1 font-black">{vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Rental vehicle'}</h2></div><Button variant="link" className="text-xs font-bold text-[#d32982]" onClick={() => goToStep(3)}>Change</Button></div><p className="mt-3 text-xs text-slate-600">{trip.location}<br />{formatTripDate(trip.start)} · {formatTripTime(trip.startTime)} → {formatTripDate(trip.end)} · {formatTripTime(trip.endTime)}</p></div><div className="border-b border-[#f2d7e5] p-5"><div className="flex items-center justify-between"><h3 className="text-sm font-black">Summary of charges</h3><Button variant="link" className="text-xs font-bold text-[#d32982]" onClick={() => goToStep(2)}>Edit</Button></div><div className="mt-3 space-y-3 text-xs">{coverages.map((code) => <div key={code} className="flex justify-between gap-3"><span>{coverageNames[code]}</span><strong>{usd(preview?.coverages.find((item) => item.code === code)?.tripPrice ?? 0)}</strong></div>)}<div className="flex justify-between border-t pt-3"><span>Service fee</span><strong>{usd(quote.fees)}</strong></div><div className="flex justify-between"><span>Tax</span><strong>{usd(quote.tax)}</strong></div><div className="flex items-end justify-between border-t pt-3"><span className="font-black">TOTAL DUE NOW</span><strong className="text-2xl">{usd(quote.total)}</strong></div></div></div><div className="p-5 text-[11px] leading-5 text-slate-500"><p className="font-black text-[#1d1e29]">By clicking Pay, I agree:</p><ul className="mt-2 list-disc space-y-1 pl-4"><li>I reviewed the coverage descriptions and exclusions.</li><li>I accept the Terms of Service and Privacy Policy.</li><li>I confirm these renter, driver, and vehicle details are accurate.</li><li>I consent to electronic policy delivery.</li>{liability && <li>I acknowledge the applicable PIP, UM, and UIM limitations.</li>}</ul></div></aside>
      </div>}
      {step === 5 && confirmation && quote && <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 text-center shadow-sm"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-8 w-8" /></div><h1 className="mt-5 text-3xl font-black">Your protection is confirmed</h1><p className="mt-3 text-slate-600">Save these references to retrieve your protection later.</p><div className="mt-6 rounded-2xl bg-slate-50 p-5 text-left text-sm"><p><strong>Confirmation:</strong> {confirmation.confirmationId}</p><p className="mt-2"><strong>Quote:</strong> {quote.quoteId}</p></div></div>}
    </section>}
    <footer className="border-t bg-white px-5 py-8 text-sm text-slate-500"><div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4"><span>© 2026 Bonzah · Foundation demonstration</span><span>Coverage & exclusions · Claims · FAQ · Manage policy</span></div></footer>
  </main>;
}
