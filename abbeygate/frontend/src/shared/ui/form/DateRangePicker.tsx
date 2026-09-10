import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronDown } from 'lucide-react';
import { formatDateInputValueLocal, formatDateUI } from '@/src/shared/lib/format';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DateInput } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';

export type DateRange = {
  start: Date;
  end: Date;
  label: string;
};

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const PRESETS = [
  {
    label: 'Today',
    getRange: () => {
      const now = new Date();
      return { start: now, end: now, label: 'Today' };
    },
  },
  {
    label: 'Month to date',
    getRange: () => {
      const now = new Date();
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now, label: 'Month to date' };
    },
  },
  {
    label: 'Year to date',
    getRange: () => {
      const now = new Date();
      return { start: new Date(now.getFullYear(), 0, 1), end: now, label: 'Year to date' };
    },
  },
  {
    label: 'Custom range',
    getRange: () => null,
  },
];

function parseDateInputValueLocal(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day);
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tempStart, setTempStart] = useState<string>(formatDateInputValueLocal(value.start));
  const [tempEnd, setTempEnd] = useState<string>(formatDateInputValueLocal(value.end));

  useEffect(() => {
    setTempStart(formatDateInputValueLocal(value.start));
    setTempEnd(formatDateInputValueLocal(value.end));
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleApplyCustom = () => {
    if (tempStart && tempEnd) {
      const s = parseDateInputValueLocal(tempStart);
      const e = parseDateInputValueLocal(tempEnd);
      if (!s || !e) return;
      onChange({ start: s, end: e, label: 'Custom' });
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <motion.div whileTap={{ scale: 0.98 }}>
        <Button
          onClick={() => setIsOpen(!isOpen)}
          variant="secondary"
          size="md"
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition shadow-sm text-sm font-semibold text-slate-700"
        >
          <Calendar className="w-4 h-4 text-slate-400" />
          <span>{value.label === 'Custom' ? `${formatDateUI(value.start)} - ${formatDateUI(value.end)}` : value.label}</span>
          <ChevronDown className={twMerge('w-4 h-4 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
        </Button>
      </motion.div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-80 sm:w-[22rem] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden z-50 origin-top-left sm:origin-top-right"
          >
            <div className="p-2 space-y-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  onClick={() => {
                    const range = preset.getRange();
                    if (range) {
                      onChange(range);
                      setIsOpen(false);
                    }
                  }}
                  variant="ghost"
                  size="sm"
                  className={clsx(
                    'w-full justify-between text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center group',
                    value.label === preset.label ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  )}
                >
                  {preset.label}
                  {value.label === preset.label && <div className="w-1.5 h-1.5 rounded-full bg-brand-primary" />}
                </Button>
              ))}
            </div>

            <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400">Custom Range</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 mb-1 block">Start</label>
                  <DateInput
                    value={tempStart}
                    onChange={(next) => setTempStart(next)}
                    aria-label="Custom range start"
                    variant="default"
                    inputClassName="h-11 rounded-lg bg-white px-2.5 pr-9 text-xs font-semibold text-slate-700 border-slate-200 focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 mb-1 block">End</label>
                  <DateInput
                    value={tempEnd}
                    onChange={(next) => setTempEnd(next)}
                    aria-label="Custom range end"
                    variant="default"
                    inputClassName="h-11 rounded-lg bg-white px-2.5 pr-9 text-xs font-semibold text-slate-700 border-slate-200 focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                  />
                </div>
              </div>
              <Button
                onClick={handleApplyCustom}
                className="w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-black transition shadow-sm"
              >
                Apply Range
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
