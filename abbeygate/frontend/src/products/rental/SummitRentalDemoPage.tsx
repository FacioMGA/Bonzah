import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Headphones,
  Info,
  MapPin,
  Menu,
  Mountain,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import type { RentalCoverageCode, RentalCoverageDiscoveryRequest, RentalCoverageDiscoveryResponse, RentalPricePreviewRequest, RentalPricePreviewResponse, RentalQuoteRequest, RentalQuoteResponse, RentalRatingVehicle, SummitVehicle } from '@facio/products';
import { Button, Checkbox, Input, Select } from '@/src/shared/ui';
import { requestDemoApi, type ApiExchange } from './demoApi';
import { ApiPresenter } from './ApiPresenter';

type CheckoutDetails = {
  firstName: string; lastName: string; dateOfBirth: string; email: string; agencyEmail: string; phone: string;
  addressLine1: string; addressLine2: string; city: string; zipCode: string; licenceNumber: string; licenceState: string;
  additionalDriverName: string; additionalDriverLicenceNumber: string; additionalDriverLicenceState: string; rentalAgency: string; rentalUse: string;
};
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const ratingVehicle = ({ id, year, make, model, class: vehicleClass, declaredValue, repairProfile, powertrain }: SummitVehicle): RentalRatingVehicle => ({
  id, year, make, model, class: vehicleClass, declaredValue, repairProfile, powertrain,
});


const coverageNames: Record<RentalCoverageCode, string> = { CDW: 'Collision Damage Waiver (CDW)', RCLI: "Renter's Contingent Liability Insurance (RCLI)", SLI: 'Supplemental Liability Insurance (SLI)', PAI_PEI: 'Personal Accident / Effects Protection (PAI/PEI)' };

type SummitPackageId = 'NONE' | 'BASIC' | 'SMART' | 'COMPLETE';
const ALL_COVERAGE_CODES: RentalCoverageCode[] = ['CDW', 'RCLI', 'SLI', 'PAI_PEI'];
const SUMMIT_PACKAGE_ORDER: SummitPackageId[] = ['NONE', 'BASIC', 'SMART', 'COMPLETE'];
const SUMMIT_PACKAGE_COVERAGES: Record<SummitPackageId, RentalCoverageCode[]> = { NONE: [], BASIC: ['CDW'], SMART: ['CDW', 'RCLI'], COMPLETE: ['CDW', 'RCLI', 'SLI', 'PAI_PEI'] };
const SUMMIT_PACKAGE_LABELS: Record<SummitPackageId, string> = { NONE: 'No extra protection', BASIC: 'Basic Protection', SMART: 'Smart Protection', COMPLETE: 'Complete Protection' };
type SummitPackagePricing = { status: 'loading' | 'ready' | 'error'; data?: RentalPricePreviewResponse };

const vehicleImage = (vehicle: SummitVehicle) => {
  const model = vehicle.model.toLowerCase();
  if (model.includes('corolla')) return '/assets/summit-rentals/corolla.webp';
  if (model.includes('rav4')) return '/assets/summit-rentals/rav4.webp';
  if (model.includes('model 3')) return '/assets/summit-rentals/model-3.webp';
  if (model.includes('911')) return '/assets/summit-rentals/porsche-911.webp';
  return '/assets/summit-rentals/apex-touring.webp';
};

const isoDate = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const displayDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const ageOn = (dateOfBirth: string, date: string) => {
  const birth = new Date(`${dateOfBirth}T12:00:00`);
  const reference = new Date(`${date}T12:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return 0;
  return reference.getFullYear() - birth.getFullYear() - Number(reference < new Date(reference.getFullYear(), birth.getMonth(), birth.getDate()));
};

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
      return <Button key={value} variant="link" size="none" aria-label={new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { dateStyle: 'long' })} onClick={() => onSelect(value)} className={`h-11 w-full text-sm font-black ${isEdge ? `bg-[#152126] text-white hover:bg-[#152126] ${edgeShape}` : isRange ? 'bg-slate-100 text-[#152126] hover:bg-slate-200' : 'hover:bg-slate-100'}`}>{day}</Button>;
    })}</div>
  </div>;
}

export function SummitRentalDemoPage() {
  const [presenter] = useState(() => new URLSearchParams(window.location.search).get('presenter') === '1');
  const [exchanges, setExchanges] = useState<ApiExchange[]>([]);
  const api = <T,>(path: string, init?: RequestInit) => requestDemoApi<T>(path, init, presenter
    ? entry => setExchanges(current => [...current.slice(-99), entry]) : undefined);
  const scrollRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(1);
  const [vehicles, setVehicles] = useState<SummitVehicle[]>([]);
  const [vehicle, setVehicle] = useState<SummitVehicle | null>(null);
  const [coverages, setCoverages] = useState<RentalCoverageCode[]>(['CDW']);
  const [selectedPackage, setSelectedPackage] = useState<SummitPackageId>('BASIC');
  const [packagePricing, setPackagePricing] = useState<Partial<Record<SummitPackageId, SummitPackagePricing>>>({});
  const [rentalUse, setRentalUse] = useState<RentalQuoteRequest['risk']['rentalUse']>('PERSONAL');
  const [additionalDriversListed, setAdditionalDriversListed] = useState(false);
  const [preview, setPreview] = useState<RentalPricePreviewResponse | null>(null);
  const [discovery, setDiscovery] = useState<RentalCoverageDiscoveryResponse | null>(null);
  const [quote, setQuote] = useState<RentalQuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [draftStart, setDraftStart] = useState('2026-09-18');
  const [draftEnd, setDraftEnd] = useState('2026-09-22');
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [search, setSearch] = useState({ location: 'Denver International Airport', pickup: '2026-09-18', pickupTime: '10:00', returnDate: '2026-09-22', returnTime: '10:00', age: '35', residence: 'CA' });
  const [checkoutDetails, setCheckoutDetails] = useState<CheckoutDetails>({
    firstName: 'Alex', lastName: 'Morgan', dateOfBirth: '1991-06-15', email: 'alex.morgan@example.test', agencyEmail: '', phone: '+1 555 010 2040',
    addressLine1: '123 Summit Demo Way', addressLine2: '', city: 'Denver', zipCode: '80202', licenceNumber: 'D0000000', licenceState: 'CA',
    additionalDriverName: '', additionalDriverLicenceNumber: '', additionalDriverLicenceState: 'CA', rentalAgency: 'Summit Rentals', rentalUse: 'Leisure',
  });
  const [agreements, setAgreements] = useState({ electronicDelivery: true, liabilityNotice: true });

  const loadVehicles = async () => {
    try {
      setError('');
      setVehicles(await api<SummitVehicle[]>('/vehicles'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load vehicles.');
    }
  };
  useEffect(() => { void loadVehicles(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);
  useEffect(() => {
    if (selectedPackage === 'NONE') { setPreview(null); return; }
    const entry = packagePricing[selectedPackage];
    setPreview(entry?.status === 'ready' ? entry.data ?? null : null);
  }, [selectedPackage, packagePricing]);
  const rentalDays = Math.max(1, Math.ceil((new Date(`${search.returnDate}T${search.returnTime}:00`).getTime() - new Date(`${search.pickup}T${search.pickupTime}:00`).getTime()) / 86_400_000));
  const rentalTotal = vehicle ? vehicle.dailyRentalPrice * rentalDays : 0;
  const protectionDailyTotal = coverages.length ? (quote ?? preview)?.coverages.filter((coverage) => coverage.selected).reduce((total, coverage) => total + coverage.dailyPrice, 0) ?? 0 : 0;
  const selectedTotal = rentalTotal + (coverages.length ? (quote ?? preview)?.total ?? 0 : 0);
  const pricingBusy = selectedPackage !== 'NONE' && packagePricing[selectedPackage]?.status !== 'ready';
  const coverageInfoSource = packagePricing.COMPLETE?.data ?? packagePricing.SMART?.data ?? packagePricing.BASIC?.data;
  const availableCoverageCodes = discovery?.coverages.filter((coverage) => coverage.available).map((coverage) => coverage.code) ?? [];
  const liabilitySelected = coverages.includes('RCLI') || coverages.includes('SLI');
  const checkoutReady = [checkoutDetails.firstName, checkoutDetails.lastName, checkoutDetails.dateOfBirth, checkoutDetails.email, checkoutDetails.phone, checkoutDetails.addressLine1, checkoutDetails.city, checkoutDetails.zipCode, checkoutDetails.licenceNumber].every((value) => value.trim())
    && (!additionalDriversListed || [checkoutDetails.additionalDriverName, checkoutDetails.additionalDriverLicenceNumber, checkoutDetails.additionalDriverLicenceState].every((value) => value.trim()))
    && rentalUse === 'PERSONAL' && agreements.electronicDelivery && (!liabilitySelected || agreements.liabilityNotice);
  const stepTitles = ['Search', 'Which vehicle do you want?', 'Protect your rental', 'Review your booking', 'Retain quote', 'Quote retained'];
  const updateCheckoutDetail = (field: keyof CheckoutDetails, value: string) => setCheckoutDetails((current) => ({ ...current, [field]: value }));

  const buildRequest = (requestedVehicle: SummitVehicle, requestedCoverages: RentalCoverageCode[]): RentalQuoteRequest => ({
    programId: 'BONZAH-US-DEMO-2026', channel: 'WEB', effectiveDate: '2026-09-03',
    risk: {
      pickup: { country: 'US', state: 'CO', location: search.location }, residence: { country: 'US', state: search.residence },
      rentalStart: `${search.pickup}T${search.pickupTime}:00-06:00`, rentalEnd: `${search.returnDate}T${search.returnTime}:00-06:00`,
      driver: { age: ageOn(checkoutDetails.dateOfBirth, search.pickup), licenceValid: Boolean(checkoutDetails.licenceNumber.trim()), additionalDriversListed, additionalDrivers: additionalDriversListed ? [{ fullName: checkoutDetails.additionalDriverName, licenceNumber: checkoutDetails.additionalDriverLicenceNumber, licenceState: checkoutDetails.additionalDriverLicenceState }] : undefined }, rentalUse, vehicle: ratingVehicle(requestedVehicle),
    }, coverages: requestedCoverages,
  });

  const fetchPackagePricing = async (requestedVehicle: SummitVehicle, packageId: SummitPackageId) => {
    const packageCoverages = SUMMIT_PACKAGE_COVERAGES[packageId];
    if (!packageCoverages.length) return;
    setPackagePricing((current) => ({ ...current, [packageId]: { status: 'loading' } }));
    try {
      const request: RentalPricePreviewRequest = { pickup: { country: 'US', state: 'CO' }, rentalStart: `${search.pickup}T${search.pickupTime}:00-06:00`, rentalEnd: `${search.returnDate}T${search.returnTime}:00-06:00`, vehicle: ratingVehicle(requestedVehicle), coverages: packageCoverages };
      const data = await api<RentalPricePreviewResponse>('/price-preview', { method: 'POST', body: JSON.stringify(request) });
      setPackagePricing((current) => ({ ...current, [packageId]: { status: 'ready', data } }));
    } catch (caught) {
      setPackagePricing((current) => ({ ...current, [packageId]: { status: 'error' } }));
      setError(caught instanceof Error ? caught.message : 'Unable to update protection price.');
    }
  };

  const fetchAllPackagePricing = (requestedVehicle: SummitVehicle) => {
    (['BASIC', 'SMART', 'COMPLETE'] as SummitPackageId[]).forEach((packageId) => { void fetchPackagePricing(requestedVehicle, packageId); });
  };

  const selectPackage = (packageId: SummitPackageId) => {
    setSelectedPackage(packageId); setCoverages(SUMMIT_PACKAGE_COVERAGES[packageId]); setQuote(null);
  };

  const selectRangeDate = (value: string) => {
    if (!rangeAnchor) {
      setDraftStart(value); setDraftEnd(''); setRangeAnchor(value);
      return;
    }
    if (value < rangeAnchor) { setDraftStart(value); setDraftEnd(rangeAnchor); }
    else { setDraftStart(rangeAnchor); setDraftEnd(value); }
    setRangeAnchor(null);
  };

  const openCalendar = () => {
    setDraftStart(search.pickup); setDraftEnd(search.returnDate); setRangeAnchor(null); setCalendarOpen(true);
  };

  const applyCalendar = () => {
    if (!draftStart || !draftEnd) return;
    setSearch({ ...search, pickup: draftStart, returnDate: draftEnd }); setCalendarOpen(false);
  };

  const loadFleetPrices = async () => {
    setError('');
    try {
      const request: RentalCoverageDiscoveryRequest = {
        pickup: { country: 'US', state: 'CO', location: search.location },
        residence: { country: 'US', state: search.residence },
        rentalStart: `${search.pickup}T${search.pickupTime}:00-06:00`,
        rentalEnd: `${search.returnDate}T${search.returnTime}:00-06:00`,
        driver: { age: Number(search.age), licenceValid: true },
        rentalUse: 'PERSONAL',
      };
      const discovered = await api<RentalCoverageDiscoveryResponse>('/coverages', { method: 'POST', body: JSON.stringify(request) });
      setDiscovery(discovered);
      if (discovered.eligibility.status !== 'QUOTED') throw new Error(discovered.eligibility.explanation);
      if (!vehicles.length) {
        await loadVehicles();
      }
      setStep(2);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load vehicles.'); }
  };

  const createFinalQuote = async () => {
    if (!vehicle) return;
    if (!coverages.length) {
      setStep(6);
      return;
    }
    setLoading(true); setError('');
    try {
      const rated = await api<RentalQuoteResponse>('/quotes', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(buildRequest(vehicle, coverages)) });
      setQuote(rated);
      if (rated.status === 'QUOTED') setStep(6);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to calculate protection.'); }
    finally { setLoading(false); }
  };

  const updateRentalUse = (nextRentalUse: RentalQuoteRequest['risk']['rentalUse']) => {
    setRentalUse(nextRentalUse); setQuote(null);
  };

  const updateAdditionalDrivers = (nextAdditionalDriversListed: boolean) => {
    setAdditionalDriversListed(nextAdditionalDriversListed); setQuote(null);
  };

  const chooseVehicle = (item: SummitVehicle) => {
    setVehicle(item); setSelectedPackage('BASIC'); setCoverages(SUMMIT_PACKAGE_COVERAGES.BASIC); setQuote(null); setPreview(null); setPackagePricing({});
    fetchAllPackagePricing(item);
  };

  return (
    <main ref={scrollRef} className="brand-route-scroll h-screen overflow-y-auto overflow-x-hidden bg-[#f4f2ed] text-[#152126]">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#101d21]/95 text-white shadow-lg backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#ef7441] shadow-[0_8px_24px_rgba(239,116,65,.3)]"><Mountain aria-hidden="true" className="h-6 w-6" /></div>
            <div><div className="text-xl font-black tracking-[-.04em]">SUMMIT</div><div className="text-[9px] font-bold tracking-[.32em] text-white/60">RENTALS</div></div>
          </div>
          <nav aria-label="Main navigation" className="hidden items-center gap-7 text-sm font-bold lg:flex">
            <span className="text-[#f58a5c]">Rent</span><span>Fleet</span><span>Locations</span><span>Business</span>
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm font-bold md:inline">Manage booking</span>
            <Menu aria-label="Open menu" className="h-6 w-6 lg:hidden" />
          </div>
        </div>
      </header>

      {step === 1 ? (
        <>
          <section aria-labelledby="search-title" className="relative isolate min-h-[480px] overflow-hidden bg-[#162a30] text-white">
            <img src="/assets/summit-rentals/rav4.webp" alt="Silver SUV overlooking the Colorado mountains" className="absolute inset-0 h-full w-full object-cover object-center" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#081418] via-[#102229]/90 to-[#102229]/15" />
            <div className="relative mx-auto max-w-7xl px-5 pb-40 pt-14 lg:px-8 lg:pb-48 lg:pt-20">
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.22em] text-[#ff9365]"><Sparkles className="h-4 w-4" /> Colorado starts here</p>
              <h1 id="search-title" className="mt-4 max-w-3xl text-5xl font-black leading-[.95] tracking-[-.055em] sm:text-6xl lg:text-7xl">Find your drive<br />from Denver.</h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/70 sm:text-lg">Distinctive cars, simple booking, and protection priced for the vehicle you choose.</p>
            </div>
          </section>

          <div className="relative z-10 mx-auto -mt-32 max-w-7xl px-5 lg:px-8">
            <section aria-label="Search for a rental car" className="overflow-hidden rounded-[28px] bg-white shadow-[0_24px_70px_rgba(15,29,33,.2)]">
              <div className="flex items-center gap-7 border-b border-slate-100 px-6 pt-4 text-sm font-black md:px-8">
                <span className="border-b-4 border-[#ef7441] pb-4 text-[#152126]">Cars</span><span className="pb-4 text-slate-400">Vans</span><span className="pb-4 text-slate-400">Long-term</span>
                <span className="ml-auto hidden text-[10px] font-black uppercase tracking-widest text-slate-400 sm:inline">Fictional booking journey</span>
              </div>
              <div className="grid gap-3 p-5 md:grid-cols-[1.35fr_1.25fr_.75fr_auto] md:p-7">
                <label className="text-xs font-black uppercase tracking-wide text-slate-500">Pickup & return
                  <div className="relative mt-2"><MapPin className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#ef7441]" /><Input aria-label="Pickup and return location" value={search.location} onChange={(event) => setSearch({ ...search, location: event.target.value })} className="min-h-[54px] pl-12" /></div>
                </label>
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Rental dates
                  <Button variant="secondary" aria-label="Choose pickup and return dates" onClick={openCalendar} className="mt-2 flex min-h-[54px] w-full justify-start rounded-2xl border-slate-200 px-4 text-left shadow-none"><CalendarDays className="mr-3 h-5 w-5 text-[#ef7441]" /><span><span className="block text-sm font-black text-[#152126]">{displayDate(search.pickup)} — {displayDate(search.returnDate)}</span><span className="block text-[10px] font-semibold text-slate-400">{search.pickupTime} to {search.returnTime} · {rentalDays} days</span></span></Button>
                </div>
                <label className="text-xs font-black uppercase tracking-wide text-slate-500">Residence
                  <Select aria-label="State of residence" value={search.residence} onChange={(event) => setSearch({ ...search, residence: event.target.value })} className="mt-2 min-h-[54px]"><option value="CA">California</option><option value="CO">Colorado</option><option value="NY">New York</option></Select>
                </label>
                <div className="text-xs font-black uppercase tracking-wide text-slate-500"><span>Search</span><Button aria-label="Show available vehicles" className="mt-2 min-h-[54px] w-full rounded-xl bg-[#ef5b2a] px-7 text-white hover:bg-[#d94b1e]" onClick={() => void loadFleetPrices()} actionId="rental.search">Show cars <ArrowRight className="ml-2 h-4 w-4" /></Button></div>
              </div>
            </section>
            {calendarOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#071216]/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setCalendarOpen(false); }}>
              <section role="dialog" aria-modal="true" aria-labelledby="date-range-title" className="w-full max-w-4xl overflow-hidden rounded-[28px] bg-white text-[#152126] shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-[#ef5b2a]">Select one rental period</p><h2 id="date-range-title" className="mt-1 text-2xl font-black">Pickup and return dates</h2></div><Button variant="ghost" size="sm" aria-label="Close date picker" onClick={() => setCalendarOpen(false)}><X className="h-5 w-5" /></Button></div>
                <div className="grid gap-8 p-6 md:grid-cols-2 md:p-8"><CalendarMonth year={2026} month={8} start={draftStart} end={draftEnd} onSelect={selectRangeDate} /><CalendarMonth year={2026} month={9} start={draftStart} end={draftEnd} onSelect={selectRangeDate} /></div>
                <div className="grid gap-4 border-t border-slate-100 px-6 py-5 md:grid-cols-2 md:px-8"><label className="text-xs font-black uppercase tracking-wide text-slate-500">Pickup time<div className="relative mt-2"><Clock3 className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#ef7441]" /><Input aria-label="Pickup time" type="time" value={search.pickupTime} onChange={(event) => setSearch({ ...search, pickupTime: event.target.value })} className="min-h-[52px] w-full min-w-0 pl-12" /></div></label><label className="text-xs font-black uppercase tracking-wide text-slate-500">Return time<div className="relative mt-2"><Clock3 className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#ef7441]" /><Input aria-label="Return time" type="time" value={search.returnTime} onChange={(event) => setSearch({ ...search, returnTime: event.target.value })} className="min-h-[52px] w-full min-w-0 pl-12" /></div></label></div>
                <div className="flex flex-col gap-4 border-t border-slate-100 bg-slate-50 px-6 py-5 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-3 text-sm"><span className="rounded-xl bg-white px-4 py-2 font-black shadow-sm">{draftStart ? displayDate(draftStart) : 'Choose pickup'}</span><ArrowRight className="h-4 w-4 text-slate-400" /><span className="rounded-xl bg-white px-4 py-2 font-black shadow-sm">{draftEnd ? displayDate(draftEnd) : 'Choose return'}</span><span className="hidden text-slate-500 sm:inline">{rangeAnchor ? 'Now choose your return date' : 'One calendar, one continuous range'}</span></div><Button disabled={!draftStart || !draftEnd} onClick={applyCalendar} className="bg-[#ef5b2a] hover:bg-[#d94b1e]">Apply rental dates</Button></div>
              </section>
            </div>}
          </div>

          <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
            <div className="grid gap-4 md:grid-cols-3">
              {[{ icon: Star, title: 'A better class of rental', copy: 'A focused fleet chosen for Colorado roads.' }, { icon: ShieldCheck, title: 'Protection that fits', copy: 'Illustrative pricing responds to the vehicle selected.' }, { icon: Headphones, title: 'Clear at every turn', copy: 'Transparent totals and customer-safe explanations.' }].map(({ icon: Icon, title, copy }) => <article key={title} className="rounded-2xl border border-[#dfe3df] bg-white p-6"><Icon className="h-6 w-6 text-[#ef7441]" /><h2 className="mt-4 text-lg font-black">{title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">{copy}</p></article>)}
            </div>
            <div className="mt-16 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-black uppercase tracking-[.2em] text-[#e26736]">Drive something memorable</p><h2 className="mt-2 text-3xl font-black tracking-[-.04em] md:text-4xl">Meet the Denver fleet</h2></div><p className="max-w-md text-sm leading-relaxed text-slate-600">From efficient city cars to EVs and mountain-ready SUVs, compare the rental and protection price together.</p></div>
            <div className="mt-7 grid gap-5 md:grid-cols-3">
              {vehicles.slice(0, 3).map((item) => <article key={item.id} className="group overflow-hidden rounded-[26px] bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"><div className="relative h-48 overflow-hidden bg-[#18272c]"><span className="absolute left-5 top-5 z-10 rounded-full bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-widest">{item.category}</span><img src={vehicleImage(item)} alt={`${item.make} ${item.model} concept vehicle`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /></div><div className="flex items-end justify-between p-5"><div><h3 className="font-black">{item.make} {item.model}</h3><p className="mt-1 text-xs text-slate-500">{item.seats} seats · {item.powertrain}</p></div><div className="text-right"><strong>{money(item.declaredValue)}</strong><p className="text-[10px] text-slate-500">replacement value</p></div></div></article>)}
            </div>
          </section>
          <footer className="bg-[#101d21] px-5 py-8 text-white"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 text-sm md:flex-row md:items-center"><div className="flex items-center gap-3 font-black"><Mountain className="h-5 w-5 text-[#ef7441]" /> SUMMIT RENTALS</div><p className="text-white/50">Fictional demo experience · No booking or policy is issued</p></div></footer>
        </>
      ) : (
      <>
        <div className="sticky top-[72px] z-40 border-b border-slate-200 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.05)]">
          <div className="mx-auto grid min-h-[96px] max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 sm:px-5 lg:px-8">
            <div className="flex min-w-0 items-center gap-1 sm:gap-3">
              <Button variant="ghost" className="-ml-2 h-12 w-12 shrink-0 rounded-full p-0 text-[#152126] hover:bg-slate-100" aria-label={`Back to ${stepTitles[Math.max(0, step - 2)]}`} onClick={() => setStep(Math.max(1, step - 1))}><ArrowLeft className="h-6 w-6" /></Button>
              <h1 className="truncate text-base font-black uppercase tracking-[-.035em] text-[#152126] sm:text-xl lg:text-[28px]">{stepTitles[step - 1]}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-3 sm:gap-5">
              {step !== 4 && vehicle && <div className="hidden text-right sm:block"><p className="flex items-baseline justify-end gap-1 text-sm font-bold text-[#152126]"><span>Total:</span><strong className="text-2xl tracking-[-.03em]">{loading || (step === 3 && pricingBusy) ? 'Updating…' : money(selectedTotal)}</strong></p></div>}
              {step === 2 && <Button className="min-h-12 rounded-xl bg-[#ef5b2a] px-5 font-black hover:bg-[#d94b1e] sm:min-w-44" disabled={!vehicle} onClick={() => setStep(3)}><span className="hidden sm:inline">Continue</span><span className="sm:hidden">Next</span><ArrowRight className="ml-2 h-4 w-4" /></Button>}
              {step === 3 && <Button className="min-h-12 rounded-xl bg-[#ef5b2a] px-5 font-black hover:bg-[#d94b1e] sm:min-w-44" disabled={pricingBusy} onClick={() => setStep(4)}><span className="hidden sm:inline">Continue</span><span className="sm:hidden">Next</span><ArrowRight className="ml-2 h-4 w-4" /></Button>}
              {step === 6 && <span className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-black text-emerald-700">Retained</span>}
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

        {step === 2 && <section aria-label="Available vehicles"><div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-xs font-black uppercase tracking-[.2em] text-[#e26736]">Available at Denver Airport</p><p className="mt-2 text-sm text-slate-500">Choose a vehicle, then see live protection prices.</p></div><div className="flex flex-wrap gap-2 text-xs font-bold text-slate-600"><span className="flex items-center gap-2 rounded-full bg-white px-4 py-2"><MapPin className="h-4 w-4 text-[#ef7441]" /> Denver Airport</span><span className="flex items-center gap-2 rounded-full bg-white px-4 py-2"><CalendarDays className="h-4 w-4 text-[#ef7441]" /> {displayDate(search.pickup)}–{displayDate(search.returnDate)}</span><span className="flex items-center gap-2 rounded-full bg-white px-4 py-2"><Clock3 className="h-4 w-4 text-[#ef7441]" /> {rentalDays} days</span></div></div>
          {discovery && <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><strong>Protection eligibility checked before vehicle selection.</strong><p className="mt-1">Available from the Bonzah workspace: {discovery.coverages.filter((coverage) => coverage.available).map((coverage) => coverage.label).join(', ')}.</p></div>}
          {!vehicles.length && <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-slate-800"><h2 className="text-lg font-black">Cars are temporarily unavailable</h2><p className="mt-2 text-sm">The rental service could not load the fleet. Try again once the local API is running.</p><Button className="mt-4 bg-[#ef5b2a] hover:bg-[#d94b1e]" onClick={() => void loadFleetPrices()}>Try again</Button></div>}
          <div className="mb-6 flex flex-wrap items-center gap-2"><Button variant="secondary" size="sm"><SlidersHorizontal className="mr-2 h-4 w-4" /> Filters</Button>{['All vehicles', 'Sedan', 'SUV', 'Electric', 'Premium'].map((filter, index) => <span key={filter} className={`rounded-full px-4 py-2 text-xs font-black ${index === 0 ? 'bg-[#152126] text-white' : 'bg-white text-slate-500'}`}>{filter}</span>)}</div>

          <div className="grid gap-5 lg:grid-cols-3">{vehicles.map((item) => <article key={item.id} role="button" tabIndex={0} aria-pressed={vehicle?.id === item.id} aria-label={`Choose ${item.make} ${item.model}`} onClick={() => chooseVehicle(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseVehicle(item); } }} className={`group cursor-pointer overflow-hidden rounded-[26px] border-2 bg-white text-left shadow-sm outline-none transition duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:ring-4 focus-visible:ring-[#ef5b2a]/30 ${vehicle?.id === item.id ? 'border-[#ef5b2a] shadow-lg' : 'border-transparent'}`}>
            <div className="relative h-52 overflow-hidden bg-[#18272c]"><span className="absolute left-4 top-4 z-10 rounded-full bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">{item.category}</span><img src={vehicleImage(item)} alt={`${item.make} ${item.model} concept vehicle`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /></div>
            <div className="p-5"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.year} · or similar</p><h2 className="mt-1 text-xl font-black">{item.make} {item.model}</h2><p className="mt-2 text-sm text-slate-600">{item.seats} seats · {item.bags} bags · {item.powertrain}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Rental rate</p><p className="mt-1 text-lg font-black">{money(item.dailyRentalPrice)}<span className="text-xs font-semibold text-slate-400">/day</span></p></div><div className="border-l border-slate-200 pl-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{rentalDays}-day total</p><p className="mt-1 text-lg font-black">{money(item.dailyRentalPrice * rentalDays)}</p></div></div>
            </div>
          </article>)}</div>
        </section>}

        {step === 3 && <section aria-label="Protection packages" className="relative">
          <div className="mb-6"><p className="text-xs font-black uppercase tracking-[.2em] text-[#e26736]">Choose your protection level</p><h2 className="mt-2 text-2xl font-black">Pick the package that&apos;s right for your trip</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Every package bundles Bonzah coverages together. Prices are calculated live for your vehicle and trip dates.</p></div>
          <div role="radiogroup" aria-label="Protection packages" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SUMMIT_PACKAGE_ORDER.map((packageId) => {
              const isSelected = selectedPackage === packageId;
              const packageCoverages = SUMMIT_PACKAGE_COVERAGES[packageId];
              const pricing = packagePricing[packageId];
              const status: 'loading' | 'ready' | 'error' = packageId === 'NONE' ? 'ready' : pricing?.status ?? 'loading';
              const data = pricing?.data;
              const dailyTotal = packageId === 'NONE' ? 0 : data ? data.coverages.filter((item) => item.selected).reduce((sum, item) => sum + item.dailyPrice, 0) : 0;
              const tripTotal = packageId === 'NONE' ? 0 : data?.total ?? 0;
              return (
                <article key={packageId} role="radio" aria-checked={isSelected} aria-label={SUMMIT_PACKAGE_LABELS[packageId]} tabIndex={0}
                  onClick={() => vehicle && selectPackage(packageId)}
                  onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && vehicle) { event.preventDefault(); selectPackage(packageId); } }}
                  className={`flex cursor-pointer flex-col rounded-[22px] border-2 bg-white text-left shadow-sm outline-none transition focus-visible:ring-4 focus-visible:ring-[#ef5b2a]/30 ${isSelected ? 'border-[#ef5b2a] shadow-lg' : 'border-transparent hover:border-slate-200'}`}>
                  <div className={`rounded-t-[20px] px-5 py-4 ${isSelected ? 'bg-[#fdece3]' : 'bg-slate-50'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-black text-[#152126]">{SUMMIT_PACKAGE_LABELS[packageId]}</h3>
                      <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${isSelected ? 'border-[#ef5b2a] bg-[#ef5b2a]' : 'border-slate-300 bg-white'}`}>{isSelected && <span className="h-2 w-2 rounded-full bg-white" />}</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2.5 px-5 py-4">
                    {(availableCoverageCodes.length ? availableCoverageCodes : ALL_COVERAGE_CODES).map((code) => { const included = packageCoverages.includes(code); const info = coverageInfoSource?.coverages.find((item) => item.code === code); return (
                      <div key={code} className="group relative flex items-center gap-2 text-xs" onClick={(event) => event.stopPropagation()}>
                        {included ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <X className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
                        <span className={included ? 'font-bold text-[#152126]' : 'text-slate-400'}>{coverageNames[code]}</span>
                        <button type="button" tabIndex={0} aria-label={`About ${coverageNames[code]}`} className="ml-auto shrink-0 rounded-full p-0.5 text-slate-300 outline-none transition hover:text-[#ef5b2a] focus-visible:text-[#ef5b2a] focus-visible:ring-2 focus-visible:ring-[#ef5b2a]/40">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                        <div role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 max-w-[80vw] -translate-x-1/2 translate-y-1 rounded-2xl bg-[#152126] p-4 text-left opacity-0 shadow-[0_16px_40px_rgba(10,15,17,.35)] transition duration-150 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
                          <p className="text-sm font-black text-white">{coverageNames[code]}</p>
                          {info ? (
                            <>
                              <div className="mt-2 flex gap-4">
                                <span className="text-[10px] font-black uppercase tracking-wide text-white/50">Limit<br /><span className="text-xs font-bold normal-case tracking-normal text-white">{info.limit}</span></span>
                                <span className="text-[10px] font-black uppercase tracking-wide text-white/50">Deductible<br /><span className="text-xs font-bold normal-case tracking-normal text-white">{info.deductible}</span></span>
                              </div>
                              <p className="mt-2.5 text-[11px] leading-relaxed text-white/75">{info.description}</p>
                            </>
                          ) : <p className="mt-2 text-[11px] leading-relaxed text-white/70">Coverage details load once pricing is ready for this vehicle.</p>}
                        </div>
                      </div>
                    ); })}
                  </div>
                  <div className="border-t border-slate-100 px-5 py-4">
                    {packageId === 'NONE' ? <p className="text-lg font-black">$0.00<span className="text-xs font-semibold text-slate-400">/day</span></p>
                      : status === 'error' ? <div className="text-xs text-red-700"><p className="font-bold">Price unavailable</p><Button variant="link" size="none" className="mt-1 font-bold text-[#d84f22]" onClick={(event) => { event.stopPropagation(); if (vehicle) void fetchPackagePricing(vehicle, packageId); }}>Retry</Button></div>
                      : status === 'loading' ? <p className="text-sm text-slate-500">Pricing…</p>
                      : <><p className="text-lg font-black">{money(dailyTotal)}<span className="text-xs font-semibold text-slate-400">/day</span></p><p className="mt-1 text-xs text-slate-500">{money(tripTotal)} trip total</p></>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>}

        {step === 4 && vehicle && <section aria-label="Booking questionnaire" className="mx-auto max-w-6xl">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="space-y-5">
              <form className="rounded-3xl bg-white p-6 shadow-sm" onSubmit={(event) => event.preventDefault()}>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                  <div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.16em] text-[#d84f22]"><ShieldCheck className="h-4 w-4" /> Coverage inputs</p><h2 className="mt-2 text-2xl font-black">Protection details</h2><p className="mt-1 text-sm text-slate-500">The details used to calculate your insurance quote.</p></div>
                  <Button variant="link" className="font-bold text-[#d84f22]" onClick={() => setStep(1)}>Edit details</Button>
                </div>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <label className="text-sm font-bold text-slate-700">Rental car pickup country<Select className="mt-2" value="US" disabled><option value="US">United States</option></Select></label>
                  <label className="text-sm font-bold text-slate-700">Rental car pickup state<Select className="mt-2" value="CO" disabled><option value="CO">Colorado</option></Select></label>
                  <label className="text-sm font-bold text-slate-700">When does your trip start?<Input className="mt-2" value={`${displayDate(search.pickup)}, ${search.pickupTime}`} readOnly /></label>
                  <label className="text-sm font-bold text-slate-700">When does your trip end?<Input className="mt-2" value={`${displayDate(search.returnDate)}, ${search.returnTime}`} readOnly /></label>
                  <div className="sm:col-span-2"><p className="text-sm font-bold text-slate-700">Rental car drop-off time</p><p className="mt-1 text-xs leading-relaxed text-slate-500">Policies are priced in 24-hour increments. Your return is within the same time cycle.</p><div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1"><span className="rounded-xl bg-white px-4 py-3 text-center text-sm font-black text-[#153128] shadow-sm">Same time</span><span className="px-4 py-3 text-center text-sm font-bold text-slate-400">Later</span></div></div>
                  <label className="text-sm font-bold text-slate-700">Country of residence<Select className="mt-2" value="US" disabled><option value="US">United States</option></Select></label>
                  <label className="text-sm font-bold text-slate-700">State of residence<Select className="mt-2" value={search.residence} disabled><option value="CA">California</option><option value="CO">Colorado</option><option value="NY">New York</option></Select></label>
                </div>

                <div className="mt-8 border-t border-slate-100 pt-7">
                  <div><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Order information</p><h3 className="mt-1 text-xl font-black">Renter&apos;s information</h3></div>
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <label className="text-sm font-bold text-slate-700">First name*<Input className="mt-2" value={checkoutDetails.firstName} onChange={(event) => updateCheckoutDetail('firstName', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">Last name*<Input className="mt-2" value={checkoutDetails.lastName} onChange={(event) => updateCheckoutDetail('lastName', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">Date of birth*<Input className="mt-2" type="date" value={checkoutDetails.dateOfBirth} onChange={(event) => updateCheckoutDetail('dateOfBirth', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">Renter&apos;s email address*<Input className="mt-2" type="email" value={checkoutDetails.email} onChange={(event) => updateCheckoutDetail('email', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">Rental agency email address <span className="font-normal text-slate-400">(optional)</span><Input className="mt-2" type="email" value={checkoutDetails.agencyEmail} placeholder="agency@example.test" onChange={(event) => updateCheckoutDetail('agencyEmail', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">Phone number*<Input className="mt-2" type="tel" value={checkoutDetails.phone} onChange={(event) => updateCheckoutDetail('phone', event.target.value)} /></label>
                  </div>
                </div>

                <div className="mt-8 border-t border-slate-100 pt-7">
                  <h3 className="text-xl font-black">Renter&apos;s address</h3>
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <label className="text-sm font-bold text-slate-700 sm:col-span-2">Address line 1*<Input className="mt-2" value={checkoutDetails.addressLine1} onChange={(event) => updateCheckoutDetail('addressLine1', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700 sm:col-span-2">Address line 2 <span className="font-normal text-slate-400">(optional)</span><Input className="mt-2" value={checkoutDetails.addressLine2} onChange={(event) => updateCheckoutDetail('addressLine2', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">City*<Input className="mt-2" value={checkoutDetails.city} onChange={(event) => updateCheckoutDetail('city', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">ZIP code*<Input className="mt-2" value={checkoutDetails.zipCode} onChange={(event) => updateCheckoutDetail('zipCode', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">Country<Select className="mt-2" value="US" disabled><option value="US">United States</option></Select></label>
                    <label className="text-sm font-bold text-slate-700">State<Select className="mt-2" value={search.residence} disabled><option value="CA">California</option><option value="CO">Colorado</option><option value="NY">New York</option></Select></label>
                  </div>
                </div>

                <div className="mt-8 border-t border-slate-100 pt-7">
                  <h3 className="text-xl font-black">Driver&apos;s information</h3>
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <label className="text-sm font-bold text-slate-700">Driver licence number<Input className="mt-2" value={checkoutDetails.licenceNumber} onChange={(event) => updateCheckoutDetail('licenceNumber', event.target.value)} /></label>
                    <label className="text-sm font-bold text-slate-700">Driver licence state<Select className="mt-2" value={checkoutDetails.licenceState} onChange={(event) => updateCheckoutDetail('licenceState', event.target.value)}><option value="CA">California</option><option value="CO">Colorado</option><option value="NY">New York</option></Select></label>
                    <div className="sm:col-span-2 rounded-2xl border border-slate-200 p-4"><Checkbox label={<span><strong>Add an additional driver</strong><span className="mt-1 block text-xs font-normal text-slate-500">They must be 21 or older, have a valid licence, and be listed on the rental agreement.</span></span>} checked={additionalDriversListed} onChange={(event) => updateAdditionalDrivers(event.target.checked)} />{additionalDriversListed && <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2"><label className="text-sm font-bold text-slate-700 sm:col-span-2">Additional driver&apos;s full name*<Input className="mt-2" value={checkoutDetails.additionalDriverName} onChange={(event) => updateCheckoutDetail('additionalDriverName', event.target.value)} /></label><label className="text-sm font-bold text-slate-700">Additional driver&apos;s licence number*<Input className="mt-2" value={checkoutDetails.additionalDriverLicenceNumber} onChange={(event) => updateCheckoutDetail('additionalDriverLicenceNumber', event.target.value)} /></label><label className="text-sm font-bold text-slate-700">Additional driver&apos;s licence state*<Select className="mt-2" value={checkoutDetails.additionalDriverLicenceState} onChange={(event) => updateCheckoutDetail('additionalDriverLicenceState', event.target.value)}><option value="CA">California</option><option value="CO">Colorado</option><option value="NY">New York</option></Select></label></div>}</div>
                  </div>
                </div>

                <div className="mt-8 border-t border-slate-100 pt-7">
                  <h3 className="text-xl font-black">Rental vehicle information</h3>
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <label className="text-sm font-bold text-slate-700">Make and model<Input className="mt-2" value={`${vehicle.make} ${vehicle.model}`} readOnly /></label>
                    <label className="text-sm font-bold text-slate-700">Year and class<Input className="mt-2" value={`${vehicle.year} · ${vehicle.category}`} readOnly /></label>
                    <label className="text-sm font-bold text-slate-700">Rental company<Select className="mt-2" value={checkoutDetails.rentalAgency} onChange={(event) => updateCheckoutDetail('rentalAgency', event.target.value)}><option value="Summit Rentals">Summit Rentals</option><option value="Other">Other licensed rental company</option></Select></label>
                    <label className="text-sm font-bold text-slate-700">Rental use<Select className="mt-2" value={rentalUse} disabled><option value="PERSONAL">Personal / leisure</option><option value="COMMERCIAL">Business or commercial</option><option value="RIDESHARE_OR_DELIVERY">Rideshare or delivery</option></Select></label>
                    <label className="text-sm font-bold text-slate-700 sm:col-span-2">Powertrain classification<Input className="mt-2 capitalize" value={vehicle.powertrain === 'ev' ? 'Electric vehicle' : vehicle.powertrain} readOnly /></label>
                  </div>
                </div>

                <div className="mt-8 border-t border-slate-100 pt-7">
                  <h3 className="text-xl font-black">Confirm before checkout</h3>
                  <div className="mt-5 space-y-4 rounded-2xl bg-slate-50 p-5 text-sm">
                    <Checkbox label="I confirm this is a personal rental, not for business, rideshare, or delivery use." checked={rentalUse === 'PERSONAL'} disabled={loading} onChange={(event) => updateRentalUse(event.target.checked ? 'PERSONAL' : 'COMMERCIAL')} />
                    <Checkbox label="I agree to receive policy documents electronically." checked={agreements.electronicDelivery} onChange={(event) => setAgreements((current) => ({ ...current, electronicDelivery: event.target.checked }))} />
                    {liabilitySelected && <Checkbox label="I acknowledge the liability coverage notice, including the applicable PIP, UM, and UIM limitations." checked={agreements.liabilityNotice} onChange={(event) => setAgreements((current) => ({ ...current, liabilityNotice: event.target.checked }))} />}
                  </div>
                </div>
                <div className="mt-8 border-t border-slate-100 pt-6">
                  {!checkoutReady && <p className="mb-3 text-sm text-slate-600">Complete the required fields and confirmations to continue.</p>}
                  {!quote ? <Button type="button" className="min-h-14 w-full rounded-xl bg-[#ef5b2a] px-8 text-base font-black hover:bg-[#d94b1e]" disabled={!checkoutReady || loading} isLoading={loading} onClick={createFinalQuote}>Retain protection quote<ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" /></Button> : quote.status === 'QUOTED' ? <Button type="button" className="min-h-14 w-full rounded-xl bg-[#ef5b2a] px-8 text-base font-black hover:bg-[#d94b1e]" onClick={() => setStep(6)}>View retained quote<ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" /></Button> : <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>{quote.message}</strong><p className="mt-1">{quote.customerExplanation[0]}</p></div>}
                </div>
              </form>

            </div>

            <aside className="overflow-hidden rounded-3xl bg-white shadow-lg lg:sticky lg:top-24">
              <div className="relative h-32 bg-[#18272c]"><img src={vehicleImage(vehicle)} alt={`${vehicle.make} ${vehicle.model} concept vehicle`} className="h-full w-full object-cover opacity-80" /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#101d21] to-transparent px-5 pb-4 pt-10 text-white"><p className="text-[9px] font-black uppercase tracking-[.16em] text-white/70">Your vehicle · {vehicle.category}</p><div className="mt-1 flex items-end justify-between gap-3"><div><p className="text-lg font-black">{vehicle.make} {vehicle.model}</p><p className="text-[11px] text-white/70">{vehicle.seats} seats · {vehicle.bags} bags · {vehicle.powertrain}</p></div><Button variant="link" className="shrink-0 text-xs font-bold text-white" onClick={() => setStep(2)}>Change</Button></div></div></div>
              <div className="border-b border-slate-100 p-4">
                <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Rental details</p><h2 className="mt-1 font-black">Denver International Airport</h2></div><Button variant="link" className="text-xs font-bold text-[#d84f22]" onClick={() => setStep(1)}>Edit</Button></div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div className="flex gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d84f22]" /><div><p className="font-bold text-slate-400">PICK-UP</p><p className="font-black">{displayDate(search.pickup)} · {search.pickupTime}</p></div></div><div className="flex gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#315b50]" /><div><p className="font-bold text-slate-400">RETURN</p><p className="font-black">{displayDate(search.returnDate)} · {search.returnTime}</p></div></div></div>
              </div>
              <div className="border-b border-slate-100 p-4">
                <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Selected protection</p><h2 className="mt-1 font-black">{SUMMIT_PACKAGE_LABELS[selectedPackage]}</h2></div><Button variant="link" className="text-xs font-bold text-[#d84f22]" onClick={() => setStep(3)}>Edit</Button></div>
                <div className="mt-2 divide-y divide-slate-100">{coverages.length ? (quote ? quote.coverages.filter((item) => item.selected).map((item) => <div key={item.code} className="flex items-center justify-between gap-3 py-2 text-xs"><div className="flex min-w-0 gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><p className="font-bold">{item.label}</p></div><strong className="shrink-0">{money(item.dailyPrice)}/day</strong></div>) : coverages.map((code) => <div key={code} className="flex items-center gap-2 py-2 text-xs"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /><p className="font-bold">{coverageNames[code]}</p></div>)) : <p className="py-2 text-xs text-slate-500">No Bonzah protection selected.</p>}</div>
              </div>
              <div className="bg-white p-4"><div className="space-y-2 text-xs"><div className="flex justify-between gap-3"><span className="text-slate-500">Rental rate</span><strong>{money(vehicle.dailyRentalPrice)}/day</strong></div>{(quote ?? preview) ? <><div className="flex justify-between gap-3"><span className="text-slate-500">Protection rate</span><strong>{money(protectionDailyTotal)}/day</strong></div><div className="flex justify-between gap-3"><span className="text-slate-500">Insurance service fee</span><strong>{money((quote ?? preview)?.fees ?? 0)}</strong></div></> : <p className="text-slate-500">Choose protection to see its price.</p>}</div><div className="mt-3 flex items-end justify-between border-t border-slate-200 pt-3"><div><p className="text-[10px] font-bold text-slate-400">{rentalDays}-DAY TRIP TOTAL</p><p className="text-[10px] text-slate-500">USD</p></div><strong className="text-3xl tracking-tight">{money((quote ?? preview) ? selectedTotal : rentalTotal)}</strong></div>{!checkoutReady && <p className="mt-2 text-center text-xs font-bold text-red-600">Complete all required renter fields</p>}</div>
            </aside>
          </div>
        </section>}

        {step === 6 && quote && vehicle && <section aria-labelledby="retained-title" className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-8 w-8" /></div><p className="text-xs font-black uppercase tracking-[.16em] text-[#d84f22]">Partner demo stops here</p><h1 id="retained-title" className="mt-2 text-3xl font-black">Your protection quote is retained</h1><p className="mt-3 text-slate-600">No payment was taken and no policy was bound. This quote can be retrieved from the Bonzah workspace.</p><div className="mt-6 rounded-2xl bg-slate-100 p-5 text-left"><div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5" /> Retained protection quote</div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><dt>Public quote token</dt><dd className="break-all text-right font-bold">{quote.quoteId}</dd><dt>Workspace policy ID</dt><dd className="break-all text-right font-bold">{quote.correlationId}</dd><dt>Protection total</dt><dd className="text-right font-bold">{money(quote.total)}</dd><dt>Rule version</dt><dd className="text-right font-bold">{quote.ruleVersion}</dd></dl></div></section>}
        </div>
      </>
      )}
      {presenter && <ApiPresenter entries={exchanges} quoteId={quote?.quoteId} retrieve={async () => {
        if (quote) await api<RentalQuoteResponse>(`/quotes/${quote.quoteId}`);
      }} />}
    </main>
  );
}
