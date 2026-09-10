import * as React from 'react';
import { cn } from '@/src/shared/lib/utils';

type MoneyInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> & {
  value: string;
  onValueChange: (next: string) => void;
  currencySymbol?: string;
  allowNegative?: boolean;
  maxDecimals?: number;
  error?: boolean;
  variant?: 'default' | 'ui';
  align?: 'left' | 'right';
  formatOnBlurOnly?: boolean;
};

function normalizeRaw(input: string, allowNegative: boolean, maxDecimals: number): string {
  const raw = String(input || '');
  const hasLeadingMinus = allowNegative && raw.trim().startsWith('-');
  const cleaned = raw.replace(/[^\d.]/g, '');
  const dotIdx = cleaned.indexOf('.');
  let intPart = '';
  let fracPart = '';
  if (dotIdx >= 0) {
    intPart = cleaned.slice(0, dotIdx).replace(/\./g, '');
    fracPart = cleaned.slice(dotIdx + 1).replace(/\./g, '').slice(0, Math.max(0, maxDecimals));
  } else {
    intPart = cleaned.replace(/\./g, '');
  }
  if (!intPart && !fracPart) return hasLeadingMinus ? '-' : '';
  if (dotIdx >= 0) {
    return `${hasLeadingMinus ? '-' : ''}${intPart || '0'}.${fracPart}`;
  }
  return `${hasLeadingMinus ? '-' : ''}${intPart}`;
}

function formatWithSeparators(input: string, maxDecimals: number): string {
  const raw = String(input || '').trim();
  if (!raw || raw === '-') return '';
  const negative = raw.startsWith('-');
  const normalized = raw.replace(/,/g, '');
  const num = Number(normalized);
  if (!Number.isFinite(num)) return '';
  const abs = Math.abs(num);
  return `${negative ? '-' : ''}${abs.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  })}`;
}

// ABY-91 — format the live draft with thousands separators while
// preserving (and where needed reconstructing) the user's caret
// position. Modern best practice: 1000 → 1,000 → 1,000,000 as the
// user types, with predictable backspace/delete semantics. We do this
// by counting digits between the input start and the caret BEFORE
// formatting, and then repositioning the caret in the formatted
// string at the same digit index.
function formatDraftWithSeparators(normalized: string, maxDecimals: number): string {
  if (!normalized || normalized === '-') return normalized;
  const negative = normalized.startsWith('-');
  const body = negative ? normalized.slice(1) : normalized;
  const dotIdx = body.indexOf('.');
  const intPart = dotIdx >= 0 ? body.slice(0, dotIdx) : body;
  const fracPart = dotIdx >= 0 ? body.slice(dotIdx + 1, dotIdx + 1 + Math.max(0, maxDecimals)) : '';
  if (!intPart && !fracPart) return negative ? '-' : '';
  const intFormatted = intPart === '' ? '' : Number(intPart).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const sign = negative ? '-' : '';
  if (dotIdx >= 0) return `${sign}${intFormatted || '0'}.${fracPart}`;
  return `${sign}${intFormatted}`;
}

function countDigitsBefore(value: string, position: number): number {
  let count = 0;
  for (let i = 0; i < Math.min(position, value.length); i += 1) {
    if (/\d/.test(value[i] || '')) count += 1;
  }
  return count;
}

function caretOffsetForDigitIndex(formatted: string, digitIndex: number): number {
  if (digitIndex <= 0) {
    // Skip past leading sign/separator if any, but keep caret at the very
    // start so the user can prepend without the cursor jumping forward.
    return 0;
  }
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/\d/.test(formatted[i] || '')) {
      seen += 1;
      if (seen === digitIndex) return i + 1;
    }
  }
  return formatted.length;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      className,
      error,
      value,
      onValueChange,
      currencySymbol = '€',
      allowNegative = false,
      maxDecimals = 2,
      disabled,
      variant = 'ui',
      align = 'right',
      formatOnBlurOnly = false,
      onBlur,
      onFocus,
      ...props
    },
    ref,
  ) => {
    const [focused, setFocused] = React.useState(false);
    // ABY-91 — `draft` is now ALWAYS the formatted display string
    // (`1,234,567`), never the raw normalised number. The raw value
    // emitted to consumers is still plain (no separators) via
    // `onValueChange(normalised)` so existing zod / RHF schemas keep
    // working unchanged.
    const [draft, setDraft] = React.useState<string>(() =>
      formatOnBlurOnly
        ? normalizeRaw(value, allowNegative, maxDecimals)
        : formatDraftWithSeparators(normalizeRaw(value, allowNegative, maxDecimals), maxDecimals),
    );
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    React.useEffect(() => {
      if (!focused) {
        const normalized = normalizeRaw(value, allowNegative, maxDecimals);
        setDraft(formatOnBlurOnly ? normalized : formatDraftWithSeparators(normalized, maxDecimals));
      }
    }, [value, focused, allowNegative, maxDecimals, formatOnBlurOnly]);

    const displayedValue = focused ? draft : formatWithSeparators(value, maxDecimals);

    return (
      <div
        className={cn(
          variant === 'ui'
            ? cn(
                'relative w-full rounded-xl border bg-control-bg text-control-text',
                'transition-[border-color,box-shadow,transform,background-color] duration-200',
                'enabled:hover:border-ui-border enabled:hover:-translate-y-px enabled:hover:shadow-md',
                'enabled:focus-within:-translate-y-px enabled:focus-within:shadow-md',
                'focus-within:bg-ui-surface focus-within:!border-ui-focus',
                'disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-100',
              )
            : cn(
                'relative w-full rounded-control border bg-ui-surface text-ui-text',
                'transition-shadow duration-200 focus-within:!border-ui-focus',
                'disabled:cursor-not-allowed disabled:opacity-100',
              ),
          error ? 'border-ui-danger' : variant === 'ui' ? 'border-control-border' : 'border-ui-border',
          className,
        )}
      >
        <span
          className={cn(
            'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-black text-slate-500',
            variant === 'ui' ? 'text-sm' : 'text-xs',
          )}
        >
          {currencySymbol}
        </span>
        <input
          {...props}
          ref={innerRef}
          type="text"
          inputMode={maxDecimals > 0 ? 'decimal' : 'numeric'}
          pattern={maxDecimals > 0 ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
          disabled={disabled}
          value={displayedValue}
          onFocus={(e) => {
            setFocused(true);
            const normalized = normalizeRaw(value, allowNegative, maxDecimals);
            setDraft(formatOnBlurOnly ? normalized : formatDraftWithSeparators(normalized, maxDecimals));
            onFocus?.(e);
          }}
          onBlur={(e) => {
            const normalized = normalizeRaw(draft, allowNegative, maxDecimals);
            onValueChange(normalized);
            setDraft(formatDraftWithSeparators(normalized, maxDecimals));
            setFocused(false);
            onBlur?.(e);
          }}
          onChange={(e) => {
            const target = e.target;
            const rawText = target.value;
            // Capture the digit-position the caret is at BEFORE we
            // re-format, so we can re-anchor it after the formatted
            // string changes width (commas added/removed).
            const caretBefore = typeof target.selectionStart === 'number' ? target.selectionStart : rawText.length;
            const digitsBeforeCaret = countDigitsBefore(rawText, caretBefore);
            const normalized = normalizeRaw(rawText, allowNegative, maxDecimals);
            const formatted = formatOnBlurOnly
              ? normalized
              : formatDraftWithSeparators(normalized, maxDecimals);
            setDraft(formatted);
            onValueChange(normalized);
            // React's controlled input contract resets the caret to
            // the end after every state update. Re-apply it on the
            // next animation frame so the user's typing position is
            // preserved natural-feeling.
            window.requestAnimationFrame(() => {
              const node = innerRef.current;
              if (!node) return;
              const nextCaret = caretOffsetForDigitIndex(formatted, digitsBeforeCaret);
              try { node.setSelectionRange(nextCaret, nextCaret); } catch { /* ignore — Safari rejects on disabled */ }
            });
          }}
          className={cn(
            'w-full bg-transparent outline-none border-0',
            align === 'left' ? 'text-left' : 'text-right',
            'tabular-nums font-semibold',
            variant === 'ui' ? 'px-4 py-4 pr-5 pl-10 text-base' : 'px-3 py-2 pr-3 pl-8 text-sm',
            'placeholder:text-control-placeholder',
          )}
        />
      </div>
    );
  },
);

MoneyInput.displayName = 'MoneyInput';

