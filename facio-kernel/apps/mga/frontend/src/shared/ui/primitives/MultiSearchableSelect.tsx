import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/src/shared/lib/utils';

interface MultiSearchableSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  onBlur?: () => void;
  options?: { value: string; label: string }[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: boolean;
  maxDisplayTags?: number;
}

export function MultiSearchableSelect({
  values,
  onChange,
  onBlur,
  options = [],
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  disabled = false,
  error = false,
  maxDisplayTags = 5,
}: MultiSearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeDropdown = React.useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    onBlur?.();
  }, [onBlur]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    return options.filter((opt) =>
      opt.label.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [options, searchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        closeDropdown();
      }
    };
    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [closeDropdown]);

  useEffect(() => {
    if (!isOpen) return;
    const updateMenuPosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 8;
      // ABY-60: align mobile behaviour with the canonical
      // `SearchableSelect`: render the menu as a full-screen overlay so
      // the search input lives INSIDE the menu (above the on-screen
      // keyboard) and options no longer "float far below" the toggle
      // (the previous bottom-anchored sheet). One source of truth for
      // the mobile dropdown UX across both single and multi pickers.
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
        maxHeight: Math.min(320, availableHeight),
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

  // ABY-60: focus the in-overlay search input when the mobile sheet
  // opens so the keyboard appears immediately above an active input.
  useEffect(() => {
    if (!isOpen || !isMobileViewport) return;
    const handle = window.setTimeout(() => {
      mobileSearchRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(handle);
  }, [isOpen, isMobileViewport]);

  const toggle = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const removeTag = (e: React.MouseEvent, value: string) => {
    e.stopPropagation();
    onChange(values.filter((v) => v !== value));
  };

  const openAndFocus = () => {
    if (disabled) return;
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const displayedTags = values.slice(0, maxDisplayTags);
  const overflowCount = values.length - maxDisplayTags;

  return (
    <div className="relative" ref={containerRef}>
      <div
        className={cn(
          'relative w-full min-h-controlLg rounded-xl px-3 py-2 font-semibold',
          'border bg-control-bg text-control-text border-control-border',
          'outline-none transition-[border-color,box-shadow,transform,background-color] duration-200',
          'flex flex-wrap items-center gap-1.5 min-w-0',
          disabled ? 'cursor-not-allowed bg-transparent text-control-disabledText' : 'cursor-pointer',
          !disabled && 'hover:border-ui-border hover:-translate-y-px hover:shadow-md focus-within:-translate-y-px focus-within:shadow-md',
          !disabled && 'focus-within:bg-ui-surface focus-within:!border-ui-focus',
          isOpen && !disabled && 'bg-ui-surface border-ui-focus',
          error && 'border-ui-danger',
        )}
        onClick={openAndFocus}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            openAndFocus();
          } else if (e.key === 'Escape') {
            setIsOpen(false);
            setSearchQuery('');
          }
        }}
      >
        {displayedTags.map((v) => {
          const opt = options.find((o) => o.value === v);
          return (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-brand-primary/10 text-brand-primary border border-brand-primary/20 px-2.5 py-0.5 text-xs font-bold max-w-[160px]"
            >
              <span className="truncate">{opt?.label ?? v}</span>
              {!disabled && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => removeTag(e, v)}
                  className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                  aria-label={`Remove ${opt?.label ?? v}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          );
        })}

        {overflowCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5 text-xs font-bold">
            +{overflowCount} more
          </span>
        )}

        {values.length === 0 && !isOpen && (
          <span className="text-control-placeholder font-semibold text-sm pl-2">{placeholder}</span>
        )}

        <input
          ref={inputRef}
          type="text"
          className={cn(
            'flex-1 min-w-[120px] bg-transparent text-sm text-control-text font-semibold',
            'border-0 p-0 pl-1 ring-0 shadow-none outline-none focus:ring-0 focus:outline-none focus:border-0',
            'placeholder:text-control-placeholder',
            !isOpen && 'w-0 min-w-0 opacity-0 pointer-events-none absolute',
          )}
          placeholder={isOpen ? searchPlaceholder : ''}
          value={searchQuery}
          onChange={(e) => { e.stopPropagation(); setSearchQuery(e.target.value); }}
          onBlur={(e) => {
            const nextTarget = e.relatedTarget as Node | null;
            if (
              nextTarget &&
              (containerRef.current?.contains(nextTarget) || menuRef.current?.contains(nextTarget))
            ) {
              return;
            }
            window.setTimeout(() => {
              closeDropdown();
            }, 0);
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeDropdown();
          }}
          tabIndex={isOpen ? 0 : -1}
          aria-hidden={!isOpen}
        />

        <span className="ml-auto pl-1 flex items-center gap-2 shrink-0">
          {values.length > 0 && (
            <span className="text-xs font-bold text-slate-500 tabular-nums">{values.length}</span>
          )}
          <ChevronDown className={cn('h-4 w-4 opacity-60 transition-transform', isOpen && 'rotate-180')} />
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
                  if (e.key === 'Escape') {
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
                aria-label="Done"
              >
                Done
              </button>
            </div>
          )}
          <div
            className={cn('mt-1', isMobileViewport && 'flex-1 overflow-y-auto overscroll-contain')}
            style={isMobileViewport ? { touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' } : undefined}
          >
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">No results found.</div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = values.includes(option.value);
                return (
                  <div
                    key={option.value}
                    className={cn(
                      'relative cursor-default select-none py-2.5 pl-5 pr-9',
                      'hover:bg-slate-50 transition-colors',
                      isSelected && 'bg-brand-primary/5 text-brand-primary font-semibold',
                    )}
                    // ABY-110 (parity with `SearchableSelect`): mousedown
                    // on a non-focusable option blurs the toggle's search
                    // input. The `onBlur` handler then schedules
                    // `setTimeout(closeDropdown, 0)`, which can race the
                    // option's own `onClick` toggle and unmount the
                    // portal before the click commits — silently
                    // dropping the selection on certain Chrome desktop
                    // builds. `preventDefault()` keeps focus on the
                    // input so the blur (and the racing setTimeout)
                    // never fires; `onClick` still commits the toggle.
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onClick={(e) => { e.stopPropagation(); toggle(option.value); }}
                  >
                    <span className="block truncate">{option.label}</span>
                    {isSelected && (
                      <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-brand-primary">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
