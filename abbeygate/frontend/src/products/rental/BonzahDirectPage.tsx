import { useState } from 'react';
import { ArrowRight, CalendarDays, Clock3, X } from 'lucide-react';
import { Button, Input, Select } from '@/src/shared/ui';
import { FacioCheckout } from './FacioCheckout';
import { rentalPrefill } from './rentalPrefill';
const states = [{ code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' }, { code: 'NY', name: 'New York' }];
const stateCodeFromName = (name: string | null): string | undefined => (name ? states.find((item) => item.name.toLowerCase() === name.toLowerCase())?.code : undefined);
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

export function BonzahDirectPage() {
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
  const [driverAge, setDriverAge] = useState('');
  const [liveCheckout, setLiveCheckout] = useState(false);
  const [tripDatesOpen, setTripDatesOpen] = useState(false);
  const [draftTrip, setDraftTrip] = useState(() => ({ start: '2026-09-18', startTime: '10:00', end: '2026-09-22', endTime: '10:00' }));
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const startQuote = () => setLiveCheckout(true);
  const selectRangeDate = (value: string) => {
    if (!rangeAnchor) { setDraftTrip((current) => ({ ...current, start: value, end: '' })); setRangeAnchor(value); return; }
    if (value < rangeAnchor) setDraftTrip((current) => ({ ...current, start: value, end: rangeAnchor }));
    else setDraftTrip((current) => ({ ...current, start: rangeAnchor, end: value }));
    setRangeAnchor(null);
  };

  if (liveCheckout) return <main className="brand-route-scroll h-screen overflow-y-auto bg-[#fff9fb] px-5 py-10"><FacioCheckout channel="DIRECT" prefill={{ ...rentalPrefill({ pickupState: trip.pickupState, residenceState: trip.residenceState, location: trip.location, start: trip.start, end: trip.end, startTime: trip.startTime, endTime: trip.endTime }), ...(driverAge ? { 'driver.age': Number(driverAge) } : {}) }} onBack={() => setLiveCheckout(false)} /></main>;
  return <main className="brand-route-scroll h-screen overflow-y-auto overflow-x-hidden bg-white text-[#1d1e29]">
    <header className="sticky top-0 z-30 border-b border-[#f2d7e5] bg-white font-['Raleway']"><div className="mx-auto flex h-16 w-[calc(100%-2.5rem)] max-w-[1130px] items-center justify-between"><a href="/bonzah" aria-label="Bonzah home"><img src="https://static.tildacdn.net/tild3433-3032-4665-b235-643337386531/Logo-footerc1ca88f88.svg" alt="Bonzah" className="h-auto w-[150px] max-w-[38vw]" /></a><nav aria-label="Bonzah navigation" className="hidden items-center gap-6 text-sm font-semibold text-[#a01e69] lg:flex"><a className="hover:text-[#e20082]" href="https://bonzah.com/faq">FAQ</a><a className="hover:text-[#e20082]" href="https://us.bonzah.com/#/orders">Download / Manage Policy</a><a className="hover:text-[#e20082]" href="https://bonzah.com/claims">Claims</a><a className="hover:text-[#e20082]" href="https://bonzah.com/about">About Us</a><a className="hover:text-[#e20082]" href="https://bonzah.com/contact">Contact Us</a></nav></div></header>
    {tripDatesOpen && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1d1e29]/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setTripDatesOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="bonzah-date-title" className="w-full max-w-4xl overflow-hidden rounded-[28px] bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#f2d7e5] px-6 py-5 md:px-8"><div><p className="text-xs font-black uppercase tracking-[.18em] text-[#d32982]">Select one rental period</p><h2 id="bonzah-date-title" className="mt-1 text-2xl font-black">Pickup and return dates</h2></div><Button variant="ghost" size="sm" aria-label="Close date picker" onClick={() => setTripDatesOpen(false)}><X className="h-5 w-5" /></Button></div><div className="grid gap-8 p-6 md:grid-cols-2 md:p-8"><CalendarMonth year={2026} month={8} start={draftTrip.start} end={draftTrip.end} onSelect={selectRangeDate} /><CalendarMonth year={2026} month={9} start={draftTrip.start} end={draftTrip.end} onSelect={selectRangeDate} /></div><div className="grid gap-4 border-t border-[#f2d7e5] px-6 py-5 md:grid-cols-2 md:px-8"><label className="text-xs font-black uppercase tracking-wide text-slate-500">Pickup time<div className="relative mt-2"><Clock3 className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#d32982]" /><Input aria-label="Pickup time" type="time" value={draftTrip.startTime} onChange={(event) => setDraftTrip({ ...draftTrip, startTime: event.target.value })} className="min-h-[52px] w-full min-w-0 pl-12" /></div></label><label className="text-xs font-black uppercase tracking-wide text-slate-500">Return time<div className="relative mt-2"><Clock3 className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#d32982]" /><Input aria-label="Return time" type="time" value={draftTrip.endTime} onChange={(event) => setDraftTrip({ ...draftTrip, endTime: event.target.value })} className="min-h-[52px] w-full min-w-0 pl-12" /></div></label></div><div className="flex flex-col gap-4 border-t border-[#f2d7e5] bg-[#fff8fb] px-6 py-5 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-3 text-sm"><span className="rounded-xl bg-white px-4 py-2 font-black shadow-sm">{draftTrip.start ? formatTripDate(draftTrip.start) : 'Choose pickup'}</span><ArrowRight className="h-4 w-4 text-slate-400" /><span className="rounded-xl bg-white px-4 py-2 font-black shadow-sm">{draftTrip.end ? formatTripDate(draftTrip.end) : 'Choose return'}</span><span className="hidden text-slate-500 sm:inline">{rangeAnchor ? 'Now choose your return date' : 'One calendar, one continuous range'}</span></div><Button disabled={!draftTrip.start || !draftTrip.end} className="bg-[#d32982] hover:bg-[#a01e69]" onClick={() => { setTrip({ ...trip, ...draftTrip }); setTripDatesOpen(false); }}>Apply rental dates</Button></div></section></div>}
    <section className="mx-auto grid w-[calc(100%-2.5rem)] max-w-[1130px] gap-6 pb-6 pt-4 font-['Raleway'] lg:grid-cols-[420px_minmax(0,1fr)]">
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
        <Button className="mt-4 min-h-11 w-full rounded-xl bg-[#1d1e29] text-sm font-semibold hover:bg-[#31323f]" onClick={startQuote}>Get my quote</Button>
      </div>
      <div className="flex flex-col overflow-hidden rounded-[24px] bg-[#fbf0f6] px-8 pb-5 pt-6 text-[#1d1e29] sm:px-9 sm:pt-7">
        <h1 className="max-w-[520px] text-[28px] font-medium leading-[1.15] tracking-[-.03em] sm:text-[36px]">Affordable,<br />Complete Protection<br />for <span className="text-[#d32982]">Your Rental Car</span></h1>
        <p className="mt-3 max-w-[520px] text-sm font-normal leading-[1.4] sm:text-base">Unlock That Covered Feeling™ with reliable rental vehicle damage and 3rd party liability coverage for your rental car at a fraction of the cost. Get an instant quote to see how much you can save.</p>
        <img src="https://static.tildacdn.net/tild3039-3338-4330-b162-633266623662/Group_79406.svg" alt="Bonzah rental car illustration" className="mx-auto mt-4 hidden w-full max-w-[220px] sm:block" />
      </div>
    </section>
  </main>;
}
