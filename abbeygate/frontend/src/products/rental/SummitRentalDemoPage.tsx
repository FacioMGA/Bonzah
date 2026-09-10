import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, Headphones, MapPin, Menu, Mountain, SlidersHorizontal, ShieldCheck, Sparkles, Star, X } from 'lucide-react';
import type { SummitVehicle } from '@facio/products';
import { Button, Input, Select } from '@/src/shared/ui';
import { requestDemoApi } from './demoApi';
import { FacioCheckout } from './FacioCheckout';
import { rentalPrefill } from './rentalPrefill';
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
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
  const scrollRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(1);
  const [vehicles, setVehicles] = useState<SummitVehicle[]>([]);
  const [vehicle, setVehicle] = useState<SummitVehicle | null>(null);
  const [error, setError] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [draftStart, setDraftStart] = useState('2026-09-18');
  const [draftEnd, setDraftEnd] = useState('2026-09-22');
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [search, setSearch] = useState({ location: 'Denver International Airport', pickup: '2026-09-18', pickupTime: '10:00', returnDate: '2026-09-22', returnTime: '10:00', residence: 'CA' });
  const loadVehicles = async () => {
    try {
      setError('');
      setVehicles(await requestDemoApi<SummitVehicle[]>('/vehicles'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load vehicles.');
    }
  };
  useEffect(() => { void loadVehicles(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);
  const rentalDays = Math.max(1, Math.ceil((Date.parse(search.returnDate) - Date.parse(search.pickup)) / 86_400_000));
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
    if (!vehicles.length) await loadVehicles();
    setStep(2);
  };

  const chooseVehicle = (item: SummitVehicle) => setVehicle(item);
  if (vehicle) return <main className="brand-route-scroll h-screen overflow-y-auto bg-[#f4f2ed] px-5 py-10"><FacioCheckout channel="DISTRIBUTION" prefill={{ ...rentalPrefill({ pickupState: 'CO', residenceState: search.residence, location: search.location, start: search.pickup, end: search.returnDate, startTime: search.pickupTime, endTime: search.returnTime }), 'vehicle.make': vehicle.make, 'vehicle.model': vehicle.model, 'vehicle.class': vehicle.class, 'vehicle.year': vehicle.year, 'vehicle.value': vehicle.declaredValue }} onBack={() => { setVehicle(null); setStep(2); }} /></main>;

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
              {[{ icon: Star, title: 'A better class of rental', copy: 'A focused fleet chosen for Colorado roads.' }, { icon: ShieldCheck, title: 'Protection that fits', copy: 'Protection quoted live by Facio after your details are entered.' }, { icon: Headphones, title: 'Clear at every turn', copy: 'Transparent totals and customer-safe explanations.' }].map(({ icon: Icon, title, copy }) => <article key={title} className="rounded-2xl border border-[#dfe3df] bg-white p-6"><Icon className="h-6 w-6 text-[#ef7441]" /><h2 className="mt-4 text-lg font-black">{title}</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">{copy}</p></article>)}
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
              <Button variant="ghost" className="-ml-2 h-12 w-12 shrink-0 rounded-full p-0 text-[#152126] hover:bg-slate-100" aria-label="Back to search" onClick={() => setStep(Math.max(1, step - 1))}><ArrowLeft className="h-6 w-6" /></Button>
              <h1 className="truncate text-base font-black uppercase tracking-[-.035em] text-[#152126] sm:text-xl lg:text-[28px]">Choose your vehicle</h1>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-9">
        {error && <div role="alert">{error}</div>}
        {step === 2 && <section aria-label="Available vehicles"><div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-xs font-black uppercase tracking-[.2em] text-[#e26736]">Available at Denver Airport</p><p className="mt-2 text-sm text-slate-500">Choose a vehicle, then see live protection prices.</p></div><div className="flex flex-wrap gap-2 text-xs font-bold text-slate-600"><span className="flex items-center gap-2 rounded-full bg-white px-4 py-2"><MapPin className="h-4 w-4 text-[#ef7441]" /> Denver Airport</span><span className="flex items-center gap-2 rounded-full bg-white px-4 py-2"><CalendarDays className="h-4 w-4 text-[#ef7441]" /> {displayDate(search.pickup)}–{displayDate(search.returnDate)}</span><span className="flex items-center gap-2 rounded-full bg-white px-4 py-2"><Clock3 className="h-4 w-4 text-[#ef7441]" /> {rentalDays} days</span></div></div>
          {!vehicles.length && <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-slate-800"><h2 className="text-lg font-black">Cars are temporarily unavailable</h2><p className="mt-2 text-sm">The rental service could not load the fleet. Try again in a moment.</p><Button className="mt-4 bg-[#ef5b2a] hover:bg-[#d94b1e]" onClick={() => void loadFleetPrices()}>Try again</Button></div>}
          <div className="mb-6 flex flex-wrap items-center gap-2"><Button variant="secondary" size="sm"><SlidersHorizontal className="mr-2 h-4 w-4" /> Filters</Button>{['All vehicles', 'Sedan', 'SUV', 'Electric', 'Premium'].map((filter, index) => <span key={filter} className={`rounded-full px-4 py-2 text-xs font-black ${index === 0 ? 'bg-[#152126] text-white' : 'bg-white text-slate-500'}`}>{filter}</span>)}</div>

          <div className="grid gap-5 lg:grid-cols-3">{vehicles.map((item) => <article key={item.id} role="button" tabIndex={0} aria-pressed={false} aria-label={`Choose ${item.make} ${item.model}`} onClick={() => chooseVehicle(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseVehicle(item); } }} className={`group cursor-pointer overflow-hidden rounded-[26px] border-2 bg-white text-left shadow-sm outline-none transition duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:ring-4 focus-visible:ring-[#ef5b2a]/30 ${false ? 'border-[#ef5b2a] shadow-lg' : 'border-transparent'}`}>
            <div className="relative h-52 overflow-hidden bg-[#18272c]"><span className="absolute left-4 top-4 z-10 rounded-full bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">{item.category}</span><img src={vehicleImage(item)} alt={`${item.make} ${item.model} concept vehicle`} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /></div>
            <div className="p-5"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{item.year} · or similar</p><h2 className="mt-1 text-xl font-black">{item.make} {item.model}</h2><p className="mt-2 text-sm text-slate-600">{item.seats} seats · {item.bags} bags · {item.powertrain}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Rental rate</p><p className="mt-1 text-lg font-black">{money(item.dailyRentalPrice)}<span className="text-xs font-semibold text-slate-400">/day</span></p></div><div className="border-l border-slate-200 pl-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{rentalDays}-day total</p><p className="mt-1 text-lg font-black">{money(item.dailyRentalPrice * rentalDays)}</p></div></div>
            </div>
          </article>)}</div>
        </section>}

        </div>
      </>
      )}
    </main>
  );
}
