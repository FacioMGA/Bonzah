import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/src/shared/lib/utils';
import { getHighlightedSelection, getNextHighlightedIndex } from './searchableSelectKeyboard';

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options?: { value: string; label: string }[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: boolean;
  loading?: boolean;
  showValidTick?: boolean;
  isValid?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  onBlur,
  options = [],
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  disabled = false,
  error = false,
  loading = false,
  showValidTick = false,
  isValid = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [internalOptions, setInternalOptions] = useState(options);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const shouldScrollHighlightedRef = useRef(false);

  const closeDropdown = React.useCallback(() => {
    if (document.activeElement === inputRef.current) inputRef.current?.blur();
    if (document.activeElement === mobileSearchRef.current) mobileSearchRef.current?.blur();
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
    onBlur?.();
  }, [onBlur]);

  useEffect(() => {
    setInternalOptions(options);
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery) return internalOptions;
    return internalOptions.filter((opt) =>
      opt.label.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [internalOptions, searchQuery]);

  useEffect(() => {
    const handlePointerOutside = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current
        && !containerRef.current.contains(target)
        && (!menuRef.current || !menuRef.current.contains(target))
      ) {
        closeDropdown();
      }
    };
    document.addEventListener('pointerdown', handlePointerOutside, true);
    document.addEventListener('mousedown', handlePointerOutside);
    return () => {
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('mousedown', handlePointerOutside);
    };
  }, [closeDropdown]);

  const selectedOption = internalOptions.find((opt) => opt.value === value);
  const hasSelection = selectedOption !== undefined;
  const selectedLabel = selectedOption?.label ?? value;

  useEffect(() => {
    if (!isOpen) return;
    const selectedIdx = filteredOptions.findIndex((opt) => opt.value === value);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : filteredOptions.length > 0 ? 0 : -1);
  }, [filteredOptions, isOpen, value]);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0 || !shouldScrollHighlightedRef.current) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    shouldScrollHighlightedRef.current = false;
  }, [highlightedIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const updateMenuPosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 8;
      // ABY-45: on mobile, the previous popover-at-bottom layout
      // collided with the on-screen keyboard hiding the toggle's
      // inline search input. Switch to a full-screen overlay panel
      // so the search input renders INSIDE the menu — visible
      // immediately above the keyboard rather than buried behind
      // the toggle that triggered the menu.
      if (window.innerWidth <= 640) {
        setIsMobileViewport(true);
        setMenuStyle({
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100dvh',
          maxHeight: '100dvh',
        });
        return;
      }
      setIsMobileViewport(false);
      const availableHeight = Math.max(160, window.innerHeight - rect.bottom - viewportPadding - 8);
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(288, availableHeight),
      });
    };
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  // ABY-45: when the mobile overlay opens, focus the in-menu search
  // input so the keyboard appears with the input already focused
  // ABOVE the keyboard rather than the (hidden) inline toggle input.
  useEffect(() => {
    if (!isOpen || !isMobileViewport) return;
    const handle = window.setTimeout(() => {
      mobileSearchRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(handle);
  }, [isOpen, isMobileViewport]);

  const commitSelection = (nextValue: string) => {
    onChange(nextValue);
    closeDropdown();
  };

  const openAndFocus = () => {
    if (disabled) return;
    setIsOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div className="relative" ref={containerRef}>
      <div
        data-hover={!disabled}
        className={cn(
          'relative w-full rounded-xl px-5 py-4 font-semibold',
          'border bg-control-bg text-control-text border-control-border',
          'outline-none transition-[border-color,box-shadow,transform,background-color] duration-200',
          'flex items-center gap-3 min-w-0',
          disabled ? 'cursor-not-allowed bg-transparent text-control-disabledText' : 'cursor-pointer',
          !disabled && 'hover:border-ui-border hover:-translate-y-px hover:shadow-md focus-within:-translate-y-px focus-within:shadow-md',
          !disabled && 'focus-within:bg-ui-surface focus-within:!border-ui-focus',
          isOpen && !disabled && 'bg-ui-surface border-ui-focus',
          error && 'border-ui-danger',
        )}
        onClick={() => {
          if (disabled) return;
          openAndFocus();
        }}
        onPointerDown={() => {
          if (disabled) return;
          setIsOpen(true);
          inputRef.current?.focus();
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.defaultPrevented || e.target === inputRef.current) return;
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            openAndFocus();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setIsOpen(false);
            setSearchQuery('');
            setHighlightedIndex(-1);
          }
        }}
        tabIndex={disabled ? -1 : 0}
      >
        <span
          className={cn(
            'block truncate font-semibold flex-1 min-w-0',
            disabled
              ? 'text-control-disabledText'
              : hasSelection
                ? 'text-control-text'
                : 'text-control-placeholder',
            isOpen && 'opacity-0 pointer-events-none',
          )}
        >
          {hasSelection ? selectedLabel : placeholder}
        </span>

        <input
          ref={inputRef}
          type="text"
          className={cn(
            'absolute left-5 right-12 top-1/2 -translate-y-1/2',
            'bg-transparent font-semibold text-[14px] text-control-text',
            'border-0 p-0 ring-0 shadow-none outline-none focus:ring-0 focus:outline-none focus:border-0',
            'placeholder:text-control-placeholder',
            !isOpen && 'opacity-0 pointer-events-none',
          )}
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onBlur={(e) => {
            const nextTarget = e.relatedTarget as Node | null;
            if (
              nextTarget
              && (containerRef.current?.contains(nextTarget) || menuRef.current?.contains(nextTarget))
            ) {
              return;
            }
            window.setTimeout(() => {
              closeDropdown();
            }, 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              e.stopPropagation();
              shouldScrollHighlightedRef.current = true;
              setHighlightedIndex((idx) => getNextHighlightedIndex(idx, filteredOptions.length, 'down'));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              e.stopPropagation();
              shouldScrollHighlightedRef.current = true;
              setHighlightedIndex((idx) => getNextHighlightedIndex(idx, filteredOptions.length, 'up'));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              const target = getHighlightedSelection(filteredOptions, highlightedIndex);
              if (target) commitSelection(target.value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              closeDropdown();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          tabIndex={isOpen ? 0 : -1}
        />

        <span className="flex items-center gap-2 shrink-0">
          {showValidTick && isValid && !isOpen && (
            <span className="bg-emerald-50 rounded-full p-1">
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
          <ChevronDown className="h-4 w-4 opacity-60" />
        </span>
      </div>

      {isOpen && !disabled && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className={cn(
            'z-[80] bg-ui-surface text-[14px]',
            isMobileViewport
              ? 'flex flex-col'
              : 'overflow-auto rounded-xl border border-ui-border shadow-lg py-1 ring-1 ring-black/5',
          )}
        >
          {isMobileViewport && (
            <div className="flex items-center gap-2 border-b border-ui-border px-4 py-3 bg-ui-surface">
              <input
                ref={mobileSearchRef}
                type="text"
                inputMode="search"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const target = getHighlightedSelection(filteredOptions, highlightedIndex);
                    if (target) commitSelection(target.value);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeDropdown();
                  }
                }}
                placeholder={searchPlaceholder}
                className="flex-1 rounded-lg border border-control-border bg-control-bg px-3 py-2 text-base font-semibold text-control-text outline-none focus:border-ui-focus"
              />
              <button
                type="button"
                onClick={closeDropdown}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600"
                aria-label="Close"
              >
                Cancel
              </button>
            </div>
          )}
          <div
            className={cn('mt-1', isMobileViewport && 'flex-1 overflow-y-auto overscroll-contain')}
            // ABY-47: explicit `touch-action: pan-y` so iOS Safari
            // does not consume vertical drags as gestures (e.g. the
            // accidental selection swipe that used to fire when an
            // option's `onPointerDown` preventDefault'd the touch
            // before the browser saw it as a scroll).
            style={isMobileViewport ? { touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' } : undefined}
          >
            {loading ? (
              <div className="flex items-center justify-center py-6 text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">No results found.</div>
            ) : (
              filteredOptions.map((option, idx) => (
                <div
                  key={option.value}
                  ref={(el) => { optionRefs.current[idx] = el; }}
                  className={[
                    'relative cursor-default select-none py-2.5 pl-5 pr-9 text-slate-900 hover:bg-slate-50',
                    idx === highlightedIndex ? 'bg-slate-100' : '',
                    value === option.value ? 'bg-slate-50 text-ui-focus font-bold' : '',
                  ].join(' ')}
                  onMouseEnter={() => {
                    shouldScrollHighlightedRef.current = false;
                    setHighlightedIndex(idx);
                  }}
                  // ABY-110: on desktop the toggle's search input has focus
                  // while the menu is open, so a plain mousedown on an
                  // option blurs the input. The `onBlur` handler then
                  // schedules a `setTimeout(closeDropdown, 0)`, racing
                  // the option's own `onClick` commit. In some Chrome
                  // desktop builds (the reported failure mode) the
                  // setTimeout wins, closeDropdown unmounts the portal
                  // before `click` is dispatched on the now-detached
                  // option, and the selection is silently lost — the
                  // dropdown closes empty. Calling `preventDefault()` on
                  // mousedown keeps focus on the input so the blur (and
                  // the racing setTimeout) never fires; the synthesized
                  // click that follows commits cleanly via `onClick`.
                  // This is the canonical menu-option pattern (Radix UI,
                  // Headless UI). On iOS the touch-then-synthesized-click
                  // path is unaffected because preventDefault on the
                  // synthetic mousedown runs after the browser has
                  // already decided the gesture wasn't a scroll (real
                  // scrolls fire touchstart / touchmove and never
                  // synthesize mousedown), so native scroll momentum is
                  // preserved — the same pattern the wizard variant of
                  // this component has used since day one.
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    commitSelection(option.value);
                  }}
                >
                  <span className="block truncate">{option.label}</span>
                  {value === option.value && (
                    <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-ui-focus">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
