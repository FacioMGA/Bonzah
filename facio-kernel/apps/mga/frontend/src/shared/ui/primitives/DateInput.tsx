import * as React from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/src/shared/lib/utils';

/**
 * DateInput — single source of truth for the hybrid date entry UX.
 *
 * Two affordances in one field:
 *   1. **Left side (the input)** — a `type="text"` input with
 *      `inputMode="numeric"` that auto-formats `DDMMYYYY` keystrokes
 *      into `DD/MM/YYYY` and parses the typed value into the canonical
 *      `YYYY-MM-DD` value emitted to the consumer.
 *   2. **Right side (calendar icon button)** — opens the shared, navigable
 *      month panel with month/year controls and range-aware date selection.
 *
 * Why a dedicated primitive instead of `<input type="date">`:
 *   - Raw browser date controls differ across browsers and could not provide
 *     Peter's larger month/year navigation. The two `Input` flavours in this
 *     repo historically diverged, so a customer could receive a different
 *     calendar depending on the screen.
 *   - Centralising typed entry and the panel lets BOTH `Input` flavours (and
 *     direct consumers) use one calendar and ISO-date contract.
 *
 * The consumer-facing value contract is the canonical ISO date string
 * (`YYYY-MM-DD`) — that is what `<input type="date">` natively emits
 * and what every Zod date schema in the repo accepts. The user-typed
 * `DD/MM/YYYY` is just the display draft.
 */
export interface DateInputProps {
  value: string;
  onChange: (next: string) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  variant?: 'default' | 'ui' | 'wizard';
  name?: string;
  id?: string;
  autoComplete?: string;
  ['aria-label']?: string;
  ['data-automation']?: string;
  showValid?: boolean;
}

function normalizeDateText(value: string): string {
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  }
  const eu = raw.match(/^(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})$/);
  if (!eu) return value;
  const day = eu[1]?.padStart(2, '0');
  const month = eu[2]?.padStart(2, '0');
  const year = eu[3];
  if (!day || !month || !year) return value;
  return `${year}-${month}-${day}`;
}

function parseDateText(value: string): string | null {
  const normalized = normalizeDateText(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return normalized;
}

function displayDateText(value: unknown): string {
  // ABY-94 — be defensive about every shape of `value` so the visible
  // text is ALWAYS DD/MM/YYYY (the agreed Cyprus + UK display format),
  // never a raw `Date.toString()` like "Sat Apr 04 2026 00:00:00 GMT…"
  // which is what RHF passed through when a parent step hydrated
  // `policy.startDate` from a server-side ISO datetime via `new Date(...)`.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const dd = String(value.getDate()).padStart(2, '0');
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const yyyy = value.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  // DD/MM/YYYY already? Pass through.
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return raw;
  // Fall back to native Date parsing (handles "Sat Apr 04 2026 …" and
  // any other format the host environment recognises). Only emit the
  // formatted result if parsing produced a real calendar date — never
  // surface the raw `toString()` to the user.
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, '0');
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const yyyy = parsed.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return '';
}

const WEEK_DAYS = ['Su', 'M', 'T', 'W', 'T', 'F', 'Sa'];
const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
export const CALENDAR_PANEL_ESTIMATED_HEIGHT = 360;
export const CALENDAR_VIEWPORT_GAP = 8;
export const CALENDAR_VIEWPORT_PADDING = 16;
export const CALENDAR_PANEL_MAX_WIDTH = 352;

export type CalendarPanelRect = Pick<DOMRect, 'top' | 'bottom' | 'right' | 'left'>;

export type CalendarPanelPositionInput = {
  rect: CalendarPanelRect;
  panelWidth: number;
  panelHeight: number;
  viewportWidth?: number;
  viewportHeight?: number;
  viewportPadding?: number;
};

/** ABY-524 — keep the shared calendar panel inside the viewport on every device. */
export function computeCalendarPanelStyle({
  rect,
  panelWidth,
  panelHeight,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768,
  viewportPadding = CALENDAR_VIEWPORT_PADDING,
}: CalendarPanelPositionInput): React.CSSProperties {
  const gap = CALENDAR_VIEWPORT_GAP;
  const viewportBottom = viewportHeight - viewportPadding;
  const spaceBelow = Math.max(0, viewportBottom - rect.bottom - gap);
  const spaceAbove = Math.max(0, rect.top - viewportPadding - gap);
  const openBelow = spaceBelow >= panelHeight || spaceBelow >= spaceAbove;
  // Do not force a minimum panel height: in a short landscape viewport the
  // available area can be smaller than 160px on both sides of the trigger.
  // The panel must shrink and scroll internally rather than extend past the
  // viewport where its dates become unreachable.
  const maxHeight = Math.min(panelHeight, openBelow ? spaceBelow : spaceAbove);
  const preferredTop = openBelow ? rect.bottom + gap : rect.top - gap - maxHeight;
  const top = Math.min(
    Math.max(viewportPadding, preferredTop),
    Math.max(viewportPadding, viewportBottom - maxHeight),
  );

  const left = Math.min(
    Math.max(viewportPadding, rect.right - panelWidth),
    viewportWidth - panelWidth - viewportPadding,
  );

  return {
    position: 'fixed',
    top,
    left,
    width: panelWidth,
    maxHeight,
    overflowY: maxHeight < panelHeight ? 'auto' : undefined,
  };
}

function isoToLocalDate(value: string): Date | null {
  const normalized = parseDateText(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function localDateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function isSameDay(left: Date, right: Date | null): boolean {
  if (!right) return false;
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function buildCalendarDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const firstVisible = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_value, index) => new Date(firstVisible.getFullYear(), firstVisible.getMonth(), firstVisible.getDate() + index));
}

function isOutsideRange(date: Date, min?: string, max?: string): boolean {
  const value = localDateToIso(date);
  return Boolean((min && value < min) || (max && value > max));
}

function formatDateDraft(value: string): string {
  // Always strip non-digits first and re-insert the separators based
  // on digit count alone — that way the input keeps the canonical
  // `DD/MM/YYYY` shape on every keystroke even when the user
  // backspaces over a `/` boundary.
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  {
    value,
    onChange,
    onBlur,
    onFocus,
    min,
    max,
    disabled,
    error,
    placeholder = 'DD/MM/YYYY',
    className,
    inputClassName,
    variant = 'wizard',
    name,
    id,
    autoComplete: _autoComplete,
    ['aria-label']: ariaLabel,
    ['data-automation']: dataAutomation,
    showValid = false,
  },
  ref,
) {
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);
  const calendarRef = React.useRef<HTMLSpanElement | null>(null);
  const calendarPanelRef = React.useRef<HTMLDivElement | null>(null);

  const [draft, setDraft] = React.useState(() => displayDateText(value));
  const [focused, setFocused] = React.useState(false);
  const isoValue = parseDateText(String(value || '')) || '';
  const selectedDate = React.useMemo(() => isoToLocalDate(isoValue), [isoValue]);
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const [visibleMonth, setVisibleMonth] = React.useState(() => startOfMonth(selectedDate || new Date()));
  const [calendarStyle, setCalendarStyle] = React.useState<React.CSSProperties>({});

  React.useEffect(() => {
    if (focused) return;
    setDraft(displayDateText(value));
  }, [focused, value]);

  React.useEffect(() => {
    if (!calendarOpen) setVisibleMonth(startOfMonth(selectedDate || new Date()));
  }, [calendarOpen, selectedDate]);

  React.useEffect(() => {
    if (!calendarOpen) return;
    const closeWhenOutside = (event: MouseEvent) => {
      if (
        event.target instanceof Node
        && !calendarRef.current?.contains(event.target)
        && !calendarPanelRef.current?.contains(event.target)
      ) {
        setCalendarOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCalendarOpen(false);
    };
    document.addEventListener('mousedown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [calendarOpen]);

  React.useLayoutEffect(() => {
    if (!calendarOpen) return;
    const updateCalendarPosition = () => {
      const rect = calendarRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = Math.min(
        CALENDAR_PANEL_MAX_WIDTH,
        window.innerWidth - CALENDAR_VIEWPORT_PADDING * 2,
      );
      const measuredHeight = calendarPanelRef.current?.getBoundingClientRect().height;
      const panelHeight = measuredHeight && measuredHeight > 0
        ? measuredHeight
        : CALENDAR_PANEL_ESTIMATED_HEIGHT;
      setCalendarStyle(computeCalendarPanelStyle({ rect, panelWidth, panelHeight }));
    };
    updateCalendarPosition();
    const raf = window.requestAnimationFrame(updateCalendarPosition);
    window.addEventListener('resize', updateCalendarPosition);
    window.addEventListener('scroll', updateCalendarPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateCalendarPosition);
      window.removeEventListener('scroll', updateCalendarPosition, true);
    };
  }, [calendarOpen, visibleMonth]);

  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.currentTarget.value;
    const nextDraft = formatDateDraft(raw);
    setDraft(nextDraft);
    const parsed = parseDateText(nextDraft);
    const parsedDate = parsed ? isoToLocalDate(parsed) : null;
    if (parsed && parsedDate && !isOutsideRange(parsedDate, min, max)) onChange(parsed);
    else if (raw.trim() === '') onChange('');
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    setFocused(false);
    const parsed = parseDateText(event.currentTarget.value);
    const parsedDate = parsed ? isoToLocalDate(parsed) : null;
    if (parsed && parsedDate && !isOutsideRange(parsedDate, min, max)) {
      setDraft(displayDateText(parsed));
      onChange(parsed);
    } else {
      setDraft(displayDateText(value));
    }
    onBlur?.(event);
  };

  const baseInputClass = (() => {
    if (variant === 'wizard') {
      return cn(
        'ui-input !h-controlLg !py-0 text-[15px] min-w-0 max-w-full',
        'text-left overflow-hidden text-ellipsis whitespace-nowrap',
        'pr-12',
        error ? 'border-red-500/70 ring-4 ring-red-500/10' : 'group-hover:border-gray-300 group-hover:shadow-lg',
      );
    }
    if (variant === 'ui') {
      return cn(
        'w-full rounded-xl px-5 py-4 font-semibold',
        'bg-control-bg border border-control-border text-control-text',
        'placeholder:text-control-placeholder',
        'outline-none transition-[border-color,box-shadow,transform,background-color] duration-200',
        'focus:bg-ui-surface focus:!border-ui-focus',
        'disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-100',
        'enabled:hover:border-ui-border enabled:hover:-translate-y-px enabled:hover:shadow-md',
        'enabled:focus:-translate-y-px enabled:focus:shadow-md',
        'pr-12',
        error ? 'border-ui-danger' : '',
      );
    }
    return cn(
      'flex h-control w-full rounded-control border bg-ui-surface px-3 py-2 text-sm text-ui-text',
      'placeholder:text-control-placeholder',
      'outline-none transition-shadow duration-200',
      'focus:!border-ui-focus pr-12',
      error ? 'border-ui-danger' : 'border-ui-border',
    );
  })();

  const valid = Boolean(showValid && !error && !disabled && draft.trim().length > 0);

  const pickerAriaLabel = `Open ${ariaLabel || 'date'} picker`;
  const calendarDays = buildCalendarDays(visibleMonth);

  const selectDate = (date: Date) => {
    const next = localDateToIso(date);
    setDraft(displayDateText(next));
    onChange(next);
    setCalendarOpen(false);
  };

  return (
    <span ref={calendarRef} className={cn('relative block w-full', variant === 'wizard' ? 'brand-input-wrap group' : '', className)}>
      <input
        ref={innerRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        name={name}
        id={id}
        aria-label={ariaLabel}
        data-automation={dataAutomation || 'date-input'}
        data-date-input="true"
        placeholder={placeholder}
        value={draft}
        disabled={disabled}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={handleBlur}
        onChange={handleTextChange}
        className={cn(baseInputClass, inputClassName)}
      />

      {valid && (
        <span className="absolute right-12 top-1/2 -translate-y-1/2 pointer-events-none">
          <span className="bg-emerald-50 rounded-full p-1 inline-flex">
            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </span>
        </span>
      )}

      <span className="absolute right-2 top-1/2 z-20 h-10 w-10 -translate-y-1/2">
        <Calendar className="pointer-events-none absolute inset-0 m-auto h-5 w-5 text-slate-400" />
        <button
          type="button"
          data-date-picker-overlay="true"
          aria-label={pickerAriaLabel}
          aria-expanded={calendarOpen}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setCalendarOpen((open) => !open)}
          className={cn(
            'absolute inset-0 z-10 cursor-pointer rounded-full bg-transparent',
            disabled ? 'pointer-events-none' : 'pointer-events-auto',
          )}
        />
      </span>

      {calendarOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={calendarPanelRef}
          role="dialog"
          aria-label={`${ariaLabel || 'Date'} calendar`}
          style={calendarStyle}
          className="z-[80] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-300 bg-white p-4 shadow-xl"
        >
          <div className="mb-3 grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-1">
            <button type="button" aria-label="Previous year" onClick={() => setVisibleMonth((month) => shiftMonth(month, -12))} className="rounded p-1.5 text-slate-700 hover:bg-slate-100">
              <ChevronsLeft className="h-5 w-5" />
            </button>
            <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))} className="rounded p-1.5 text-slate-700 hover:bg-slate-100">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="text-center text-base font-semibold text-slate-700">{MONTH_LABEL.format(visibleMonth)}</p>
            <button type="button" aria-label="Next month" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))} className="rounded p-1.5 text-slate-700 hover:bg-slate-100">
              <ChevronRight className="h-5 w-5" />
            </button>
            <button type="button" aria-label="Next year" onClick={() => setVisibleMonth((month) => shiftMonth(month, 12))} className="rounded p-1.5 text-slate-700 hover:bg-slate-100">
              <ChevronsRight className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
            {WEEK_DAYS.map((day) => <span key={day} className="pb-1 font-medium text-slate-600">{day}</span>)}
            {calendarDays.map((date) => {
              const selected = isSameDay(date, selectedDate);
              const inMonth = date.getMonth() === visibleMonth.getMonth();
              const unavailable = isOutsideRange(date, min, max);
              return (
                <button
                  key={localDateToIso(date)}
                  type="button"
                  aria-label={date.toLocaleDateString('en-GB', { dateStyle: 'full' })}
                  aria-pressed={selected}
                  disabled={unavailable}
                  onClick={() => selectDate(date)}
                  className={cn(
                    'mx-auto flex h-10 w-10 items-center justify-center rounded text-base transition-colors',
                    selected ? 'bg-amber-300 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-100',
                    !inMonth ? 'text-slate-400' : '',
                    unavailable ? 'cursor-not-allowed opacity-35 hover:bg-transparent' : '',
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
});

DateInput.displayName = 'DateInput';
