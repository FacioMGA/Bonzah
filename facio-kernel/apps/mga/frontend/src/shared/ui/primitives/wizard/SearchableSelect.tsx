import { useState, useEffect, useRef, useMemo } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { getHighlightedSelection, getNextHighlightedIndex } from '@/src/shared/ui/primitives/searchableSelectKeyboard';

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: { value: string; label: string }[];
  placeholder?: string;
  searchPlaceholder?: string;
  label?: string;
  disabled?: boolean;
  error?: boolean;
  showValid?: boolean;
  onSearch?: (query: string) => void;
  loading?: boolean;
  clearSelectionOnOpen?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  disabled = false,
  error = false,
  showValid = false,
  onSearch,
  loading = false,
  clearSelectionOnOpen = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [internalOptions, setInternalOptions] = useState(options);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  const closeDropdown = () => {
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  useEffect(() => {
    setInternalOptions(options);
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (onSearch) return internalOptions;
    if (!searchQuery) return internalOptions;

    return internalOptions.filter((opt) =>
      opt.label.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [internalOptions, searchQuery, onSearch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };

    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isOpen]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (onSearch && query.length >= 2) {
      onSearch(query);
    }
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    closeDropdown();
    inputRef.current?.blur();
  };

  const openAndFocus = () => {
    if (disabled) return;
    if (clearSelectionOnOpen && String(value || '').trim().length > 0) {
      onChange('');
    }
    setSearchQuery('');
    setIsOpen(true);
    inputRef.current?.focus();
  };

  const selectedLabel = internalOptions.find((opt) => opt.value === value)?.label || value;
  const valid = Boolean(showValid && !error && !disabled && String(value || '').trim().length > 0);
  const visibleValue = isOpen ? searchQuery : (value ? selectedLabel : '');

  useEffect(() => {
    if (!isOpen) return;
    const selectedIdx = filteredOptions.findIndex((opt) => opt.value === value);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : filteredOptions.length > 0 ? 0 : -1);
  }, [filteredOptions, isOpen, value]);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  return (
    <div
      className={`relative ${isOpen ? 'z-[70]' : ''}`}
      ref={containerRef}
    >
      {/* ABY-176 — shortened from duration-300 to duration-150 so the hover lift
          animation completes before the React state update renders the dropdown,
          preventing the perceived "responds only after hover off" delay. */}
      <div className="relative group transition-transform duration-150 ease-out hover:-translate-y-px">
        <input
          ref={inputRef}
          type="text"
          className={`ui-select !h-controlLg !py-0 text-[15px] pr-12 ${error ? 'border-red-500/70 !important ring-4 ring-red-500/10' : 'group-hover:border-gray-300 group-hover:shadow-lg'} ${!value && !isOpen ? 'text-slate-400 placeholder:text-slate-400 font-medium' : 'text-slate-700 font-semibold'}`}
          disabled={disabled}
          value={visibleValue}
          placeholder={isOpen ? searchPlaceholder : placeholder}
          onFocus={() => {
            openAndFocus();
          }}
          onPointerDown={() => {
            if (disabled) return;
            setIsOpen(true);
            inputRef.current?.focus();
          }}
          onClick={() => {
            openAndFocus();
          }}
          onChange={handleSearchChange}
          onBlur={(e) => {
            const nextTarget = e.relatedTarget as Node | null;
            if (!nextTarget || !containerRef.current?.contains(nextTarget)) {
              window.setTimeout(() => {
                if (!containerRef.current?.contains(document.activeElement)) closeDropdown();
              }, 0);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightedIndex((idx) => getNextHighlightedIndex(idx, filteredOptions.length, 'down'));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightedIndex((idx) => getNextHighlightedIndex(idx, filteredOptions.length, 'up'));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const target = getHighlightedSelection(filteredOptions, highlightedIndex);
              if (target) handleSelect(target.value);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              closeDropdown();
              inputRef.current?.blur();
            }
          }}
        />
        <div className="absolute right-4 top-1/2 -translate-y-1/2 ml-2 flex items-center gap-2 shrink-0 pointer-events-none">
          {valid && (
            <div className="bg-emerald-50 rounded-full p-1">
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </div>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-[60] mt-2 max-h-72 w-full overflow-auto rounded-2xl bg-white shadow-2xl shadow-slate-200/50 py-1 text-[15px] focus:outline-none">
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-slate-500 font-semibold">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-slate-400" />
                Loading...
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500 font-semibold">
                No results found.
              </div>
            ) : (
              filteredOptions.map((option, idx) => (
                <div
                  key={option.value}
                  ref={(el) => { optionRefs.current[idx] = el; }}
                  className={`
                          relative cursor-default select-none py-2.5 px-5 text-slate-800 hover:bg-slate-50
                          ${idx === highlightedIndex ? 'bg-slate-100' : ''}
                          ${value === option.value ? 'bg-brand-primary/10 text-brand-primary font-black' : 'font-semibold'}
                       `}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(option.value);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <span className="block truncate">{option.label}</span>
                  {value === option.value && (
                    <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-brand-primary">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
