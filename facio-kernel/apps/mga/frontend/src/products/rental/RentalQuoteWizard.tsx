import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RentalCoverageCode, RentalCoveragePrice, RentalVehicleClass, RentalPowertrain, RentalRepairProfile } from '@facio/products';
import { createSessionAdapter } from '@/src/shared/lib/wizard';
import { Button, Input, Select } from '@/src/shared/ui';

type JsonRecord = Record<string, unknown>;
type VehicleDraft = {
  year: string;
  make: string;
  model: string;
  class: RentalVehicleClass;
  declaredValue: string;
  repairProfile: RentalRepairProfile;
  powertrain: RentalPowertrain;
};
type RentalRatingView = { status: string; chargedPeriods: number; total: number; coveragePrices: RentalCoveragePrice[] };

const adapter = createSessionAdapter({ productCode: 'rental' });
const COVERAGES: Array<{ code: RentalCoverageCode; label: string; description: string }> = [
  { code: 'CDW', label: 'Collision Damage Waiver', description: 'Protection for covered damage to the rental vehicle.' },
  { code: 'RCLI', label: "Renter's Contingent Liability", description: 'Primary third-party liability protection.' },
  { code: 'SLI', label: 'Supplemental Liability', description: 'Additional liability protection; requires RCLI.' },
  { code: 'PAI_PEI', label: 'Personal Accident / Effects', description: 'Accident medical and personal-effects protection.' },
];

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const blankVehicle: VehicleDraft = { year: '2025', make: 'Toyota', model: 'Camry', class: 'sedan', declaredValue: '29000', repairProfile: 'standard', powertrain: 'combustion' };

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <div className="rounded-3xl border border-[#f2d7e5] bg-white p-7 shadow-lg"><h1 className="text-3xl font-black tracking-tight">{title}</h1><p className="mb-7 mt-2 text-sm text-slate-600">{subtitle}</p>{children}</div>;
}

function stepFromQuery(value: string | null) {
  return ['rental-search', 'vehicle', 'protection', 'your-details', 'your-quote'].includes(String(value)) ? String(value) : 'vehicle';
}

export default function RentalQuoteWizard({ policyId }: { policyId: string }) {
  const [params, setParams] = useSearchParams();
  const [step, setStep] = useState(() => stepFromQuery(params.get('step')));
  const [quoteData, setQuoteData] = useState<JsonRecord>({});
  const [vehicle, setVehicle] = useState<VehicleDraft>(blankVehicle);
  const [coverages, setCoverages] = useState<RentalCoverageCode[]>(['CDW']);
  const [person, setPerson] = useState({ firstName: '', lastName: '', email: '', phone: '', licenceNumber: '', licenceState: 'CA' });
  const [initial, setInitial] = useState({ pickupState: 'CO', residenceState: 'CA', tripStart: '', tripEnd: '', pickupTime: '10:00', dropoffTime: '10:00', driverAge: '35' });
  const [quote, setQuote] = useState<RentalRatingView | null>(null);
  const [policyNumber, setPolicyNumber] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void adapter.load(policyId).then((result) => {
      if (!result.ok || !result.session) throw new Error(result.error || 'Quote session could not be loaded.');
      const data = asRecord(result.session.quoteData);
      const risk = asRecord(data.risk);
      const pickup = asRecord(risk.pickup);
      const residence = asRecord(risk.residence);
      const driver = asRecord(risk.driver);
      const savedVehicle = asRecord(risk.vehicle);
      const datePart = (value: unknown) => String(value || '').slice(0, 10);
      const timePart = (value: unknown) => String(value || '').slice(11, 16) || '10:00';
      setQuoteData(data);
      setInitial({ pickupState: String(pickup.state || 'CO'), residenceState: String(residence.state || 'CA'), tripStart: datePart(risk.rentalStart), tripEnd: datePart(risk.rentalEnd), pickupTime: timePart(risk.rentalStart), dropoffTime: timePart(risk.rentalEnd), driverAge: String(driver.age || 35) });
      if (Object.keys(savedVehicle).length) setVehicle({ year: String(savedVehicle.year || 2025), make: String(savedVehicle.make || ''), model: String(savedVehicle.model || ''), class: (savedVehicle.class || 'sedan') as RentalVehicleClass, declaredValue: String(savedVehicle.declaredValue || ''), repairProfile: (savedVehicle.repairProfile || 'standard') as RentalRepairProfile, powertrain: (savedVehicle.powertrain || 'combustion') as RentalPowertrain });
      if (Array.isArray(data.coverages)) setCoverages(data.coverages as RentalCoverageCode[]);
      setPolicyNumber(String(result.session.policyNumber || ''));
      setBusy(false);
    }).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : 'Quote session could not be loaded.'); setBusy(false); });
  }, [policyId]);

  const go = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('step', next);
    setParams(nextParams, { replace: true });
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (patch: JsonRecord, next: string) => {
    setBusy(true); setError('');
    const merged = { ...quoteData, ...patch };
    const result = await adapter.patch(policyId, { quoteData: merged, step: next });
    setBusy(false);
    if (!result.ok) { setError(result.error || 'Your answers could not be saved.'); return; }
    setQuoteData(merged);
    go(next);
  };

  const saveInitial = () => save({
    programId: 'BONZAH-US-FOUNDATION-2026', channel: 'WEB', effectiveDate: initial.tripStart,
    risk: { ...asRecord(quoteData.risk), pickup: { country: 'US', state: initial.pickupState }, residence: { country: 'US', state: initial.residenceState }, rentalStart: `${initial.tripStart}T${initial.pickupTime}:00Z`, rentalEnd: `${initial.tripEnd}T${initial.dropoffTime}:00Z`, driver: { age: Number(initial.driverAge), licenceValid: true, additionalDriversListed: false }, rentalUse: 'PERSONAL' },
    coverages,
  }, 'vehicle');

  const saveVehicle = () => save({ risk: { ...asRecord(quoteData.risk), vehicle: { year: Number(vehicle.year), make: vehicle.make.trim(), model: vehicle.model.trim(), class: vehicle.class, declaredValue: Number(vehicle.declaredValue), repairProfile: vehicle.repairProfile, powertrain: vehicle.powertrain } } }, 'protection');
  const saveProtection = () => save({ coverages }, 'your-details');

  const rate = async () => {
    setBusy(true); setError('');
    const details = { policyholder: person };
    const saved = await adapter.patch(policyId, { quoteData: { ...quoteData, ...details }, step: 'your-quote', materializeAccount: true });
    if (!saved.ok) { setBusy(false); setError(saved.error || 'Your details could not be saved.'); return; }
    const rated = await adapter.rate(policyId);
    if (!rated.ok || !rated.quoteResponse) { setBusy(false); setError(rated.error || 'A quote could not be calculated.'); return; }
    setQuote(rated.quoteResponse as RentalRatingView);
    const refreshed = await adapter.load(policyId);
    setPolicyNumber(String(refreshed.session?.policyNumber || policyNumber));
    setBusy(false);
    go('your-quote');
  };

  const vehicleReady = Number(vehicle.year) >= 2000 && Boolean(vehicle.make.trim() && vehicle.model.trim()) && Number(vehicle.declaredValue) > 0;
  const initialReady = Boolean(initial.tripStart && initial.tripEnd && Number(initial.driverAge) >= 21);
  const personReady = Object.values(person).every((value) => value.trim());
  const progress = useMemo(() => ({ 'rental-search': 1, vehicle: 2, protection: 3, 'your-details': 4, 'your-quote': 5 }[step] || 2), [step]);

  if (busy && !Object.keys(quoteData).length) return <main className="min-h-screen grid place-items-center bg-[#fff8fb] text-[#a01e69] font-bold">Opening your Bonzah quote…</main>;
  return (
    <main className="min-h-screen bg-[#fff8fb] text-[#1d1e29]">
      <header className="border-b border-[#f2d7e5] bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5"><div className="text-3xl font-black tracking-tight text-[#d32982]">bonzah</div><div className="text-right"><p className="text-xs font-black uppercase tracking-widest text-[#a01e69]">Rental protection</p><p className="text-xs text-slate-500">Step {progress} of 5</p></div></div></header>
      <div className="h-1 bg-[#f2d7e5]"><div className="h-full bg-[#d32982] transition-all" style={{ width: `${progress * 20}%` }} /></div>
      <section className="mx-auto max-w-3xl px-5 py-10">
        {error && <div role="alert" className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
        {step === 'rental-search' && <Panel title="Tell us about your rental" subtitle="These starting questions determine where and when cover applies."><div className="grid gap-4 sm:grid-cols-2"><Input aria-label="Pickup state" placeholder="Pickup state" value={initial.pickupState} onChange={(e) => setInitial({ ...initial, pickupState: e.target.value.toUpperCase() })} /><Input aria-label="State of residence" placeholder="State of residence" value={initial.residenceState} onChange={(e) => setInitial({ ...initial, residenceState: e.target.value.toUpperCase() })} /><Input aria-label="Pickup date" type="date" value={initial.tripStart} onChange={(e) => setInitial({ ...initial, tripStart: e.target.value })} /><Input aria-label="Return date" type="date" value={initial.tripEnd} onChange={(e) => setInitial({ ...initial, tripEnd: e.target.value })} /><Input aria-label="Pickup time" type="time" value={initial.pickupTime} onChange={(e) => setInitial({ ...initial, pickupTime: e.target.value })} /><Input aria-label="Return time" type="time" value={initial.dropoffTime} onChange={(e) => setInitial({ ...initial, dropoffTime: e.target.value })} /><Input aria-label="Driver age" placeholder="Driver age" type="number" min="21" value={initial.driverAge} onChange={(e) => setInitial({ ...initial, driverAge: e.target.value })} /></div><Button className="mt-6 w-full bg-[#d32982] hover:bg-[#a01e69]" disabled={!initialReady || busy} onClick={() => void saveInitial()}>Continue to vehicle details</Button></Panel>}
        {step === 'vehicle' && <Panel title="Which vehicle are you renting?" subtitle="The demo already supplied your trip details, so we start here."><div className="grid gap-4 sm:grid-cols-2"><Input aria-label="Year" placeholder="Year" type="number" value={vehicle.year} onChange={(e) => setVehicle({ ...vehicle, year: e.target.value })} /><Input aria-label="Make" placeholder="Make" value={vehicle.make} onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })} /><Input aria-label="Model" placeholder="Model" value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} /><Select aria-label="Vehicle class" value={vehicle.class} onChange={(e) => setVehicle({ ...vehicle, class: e.target.value as RentalVehicleClass })}><option value="compact">Compact</option><option value="sedan">Sedan</option><option value="suv">SUV</option></Select><Input aria-label="Declared value" placeholder="Declared value" type="number" value={vehicle.declaredValue} onChange={(e) => setVehicle({ ...vehicle, declaredValue: e.target.value })} /><Select aria-label="Powertrain" value={vehicle.powertrain} onChange={(e) => setVehicle({ ...vehicle, powertrain: e.target.value as RentalPowertrain })}><option value="combustion">Petrol / diesel</option><option value="hybrid">Hybrid</option><option value="ev">Electric</option></Select><Select aria-label="Repair profile" value={vehicle.repairProfile} onChange={(e) => setVehicle({ ...vehicle, repairProfile: e.target.value as RentalRepairProfile })}><option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option></Select></div><Button className="mt-6 w-full bg-[#d32982] hover:bg-[#a01e69]" disabled={!vehicleReady || busy} onClick={() => void saveVehicle()}>Continue to protection</Button></Panel>}
        {step === 'protection' && <Panel title="Choose your Bonzah protection" subtitle="Select one or more coverages for this rental."><div className="space-y-3">{COVERAGES.map((item) => <label key={item.code} className="flex gap-3 rounded-2xl border border-[#f2d7e5] bg-white p-4"><input type="checkbox" className="mt-1 h-4 w-4 accent-[#d32982]" checked={coverages.includes(item.code)} onChange={(e) => setCoverages((current) => e.target.checked ? [...current, item.code] : current.filter((code) => code !== item.code))} /><span><strong>{item.label}</strong><span className="mt-1 block text-sm text-slate-600">{item.description}</span></span></label>)}</div><Button className="mt-6 w-full bg-[#d32982] hover:bg-[#a01e69]" disabled={!coverages.length || busy} onClick={() => void saveProtection()}>Continue to your details</Button></Panel>}
        {step === 'your-details' && <Panel title="Your details" subtitle="We use these details to prepare the quote and make it visible to the Bonzah team."><div className="grid gap-4 sm:grid-cols-2"><Input aria-label="First name" placeholder="First name" value={person.firstName} onChange={(e) => setPerson({ ...person, firstName: e.target.value })} /><Input aria-label="Last name" placeholder="Last name" value={person.lastName} onChange={(e) => setPerson({ ...person, lastName: e.target.value })} /><Input aria-label="Email" placeholder="Email" type="email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} /><Input aria-label="Phone" placeholder="Phone" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} /><Input aria-label="Driver licence number" placeholder="Driver licence number" value={person.licenceNumber} onChange={(e) => setPerson({ ...person, licenceNumber: e.target.value })} /><Input aria-label="Licence state" placeholder="Licence state" value={person.licenceState} onChange={(e) => setPerson({ ...person, licenceState: e.target.value.toUpperCase() })} /></div><Button className="mt-6 w-full bg-[#d32982] hover:bg-[#a01e69]" disabled={!personReady || busy} onClick={() => void rate()}>Create my quote</Button></Panel>}
        {step === 'your-quote' && quote && <Panel title="Your Bonzah quote is ready" subtitle={policyNumber ? `Quote reference ${policyNumber}` : 'Your quote is saved in the Bonzah workspace.'}><div className="rounded-3xl bg-[#1d1e29] p-7 text-white"><p className="text-xs font-black uppercase tracking-widest text-[#f8b7d8]">Total protection</p><p className="mt-2 text-5xl font-black">{money(quote.total)}</p><p className="mt-2 text-sm text-slate-300">{quote.chargedPeriods} charged day{quote.chargedPeriods === 1 ? '' : 's'} · {quote.status}</p></div><div className="mt-5 space-y-2">{quote.coveragePrices.filter((item) => item.selected).map((item) => <div key={item.code} className="flex justify-between rounded-xl bg-[#fff8fb] px-4 py-3 text-sm"><span>{item.label}</span><strong>{money(item.tripPrice)}</strong></div>)}</div></Panel>}
      </section>
    </main>
  );
}
