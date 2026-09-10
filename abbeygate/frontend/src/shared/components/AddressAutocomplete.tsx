
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Input } from '@/src/shared/ui';

import { logger } from '@/src/shared/lib/logger';

type GoogleAddressComponent = {
    long_name: string;
    short_name: string;
    types: string[];
};

type LegacyPrediction = {
    place_id: string;
    description: string;
    structured_formatting?: {
        main_text?: string;
        secondary_text?: string;
    };
};

type LegacyPlaceDetails = {
    address_components?: GoogleAddressComponent[];
    formatted_address?: string;
};

type LegacyAutocompleteService = {
    getPlacePredictions: (
        request: {
            input: string;
            sessionToken?: unknown;
            componentRestrictions?: { country: string[] };
        },
        callback: (predictions: LegacyPrediction[] | null, status: string) => void,
    ) => void;
};

type LegacyPlacesService = {
    getDetails: (
        request: { placeId: string; fields: string[]; sessionToken?: unknown },
        callback: (place: LegacyPlaceDetails | null, status: string) => void,
    ) => void;
};

// `AutocompleteService.getPlacePredictions` returns `predictions: null`
// AND a status string in the same callback arg. The only "success"
// status is `OK`; every other value (`ZERO_RESULTS`, `REQUEST_DENIED`,
// `OVER_QUERY_LIMIT`, `INVALID_REQUEST`, `NOT_FOUND`, ...) means the
// caller cannot trust `predictions` and SHOULD fall back. `ZERO_RESULTS`
// is a "no matches" success; treat it as a clean no-op. Any other
// non-OK status is a real failure path.
const AUTOCOMPLETE_OK_STATUS = 'OK';
const AUTOCOMPLETE_NO_MATCHES_STATUS = 'ZERO_RESULTS';

type ModernPlace = {
    formattedAddress?: string;
    addressComponents?: Array<{
        longText?: string;
        shortText?: string;
        types?: string[];
    }>;
    fetchFields?: (args: { fields: string[] }) => Promise<void>;
};

type ModernSuggestion = {
    placePrediction?: {
        placeId: string;
        text?: { text?: string };
        mainText?: { text?: string };
        secondaryText?: { text?: string };
        toPlace?: () => ModernPlace;
    };
};

type ModernAutocompleteSuggestion = {
    fetchAutocompleteSuggestions: (request: {
        input: string;
        sessionToken?: unknown;
        includedRegionCodes?: string[];
    }) => Promise<{ suggestions: ModernSuggestion[] }>;
};

type GoogleMapsFacade = {
    places?: {
        AutocompleteSuggestion?: ModernAutocompleteSuggestion;
        AutocompleteSessionToken?: new () => unknown;
        Place?: new (args: { id: string }) => ModernPlace;
        AutocompleteService?: new () => LegacyAutocompleteService;
        PlacesService?: new (attrContainer: HTMLElement) => LegacyPlacesService;
    };
    importLibrary?: (name: string) => Promise<unknown>;
};

declare global {
    interface Window {
        google?: { maps?: GoogleMapsFacade };
        gm_authFailure?: () => void;
        // Set by `installGlobalAuthFailureHook` so multiple mounts of
        // AddressAutocomplete don't each replace `window.gm_authFailure`.
        __facioGmAuthHooked?: boolean;
    }
}

/**
 * Module-level flag toggled when Google calls `window.gm_authFailure` (their
 * only signal for `InvalidKeyMapError`, `RefererNotAllowedMapError`,
 * `ApiNotActivatedMapError`, etc.). Once tripped, every mounted instance of
 * this component renders a plain input so the user is never blocked.
 */
let googleMapsAuthFailed = false;
const authFailureSubscribers = new Set<() => void>();

function installGlobalAuthFailureHook() {
    if (typeof window === 'undefined') return;
    const existing = window.gm_authFailure;
    if (window.__facioGmAuthHooked) return;
    window.__facioGmAuthHooked = true;
    window.gm_authFailure = () => {
        googleMapsAuthFailed = true;
        // This is a configuration problem (key, billing, referrer allow-list),
        // not a runtime regression — keep it at warn level so observability
        // dashboards aren't constantly red on misconfigured environments.
        logger.warn(
            '[Google Maps] Authentication failed (InvalidKeyMapError or RefererNotAllowedMapError). ' +
            'Address autocomplete falls back to plain input. Check the API key, enable Maps JavaScript API + Places API, ' +
            'and allow the current origin in Google Cloud Console.'
        );
        for (const notify of authFailureSubscribers) {
            try { notify(); } catch { /* noop */ }
        }
        if (typeof existing === 'function') {
            try { existing(); } catch { /* noop */ }
        }
    };
}

interface AddressData {
    address: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
}

interface Props {
    value: string;
    onChange: (val: string) => void;
    onAddressSelect: (data: AddressData) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    inputVariant?: React.ComponentProps<typeof Input>['variant'];
    /**
     * ISO-3166-1 alpha-2 country codes (e.g. `['CY']`) that limit the
     * Google Places suggestions to the listed jurisdictions. Used by
     * customer-facing wizards on `abbeygate-{cy,pt,gr,es}.facio.io` to
     * stop USA / international results from polluting a quote whose
     * property/policyholder is contractually in the operating tenant's
     * country (ABY-299). Omit / pass empty to disable the restriction
     * (BO surfaces that legitimately need international addresses).
     * Google supports up to 5 codes for both modern (`includedRegionCodes`)
     * and legacy (`componentRestrictions.country`) request shapes.
     */
    componentRestrictions?: string[];
}

interface Suggestion {
    placeId: string;
    primary: string;
    secondary: string;
}

function extractAddressFromComponents(
    components: GoogleAddressComponent[],
    formatted: string,
): AddressData {
    let city = '';
    let state = '';
    let zip = '';
    let country = '';
    let streetNumber = '';
    let route = '';

    for (const component of components) {
        const types = Array.isArray(component.types) ? component.types : [];
        if (types.includes('street_number')) streetNumber = component.long_name;
        if (types.includes('route')) route = component.long_name;
        if (types.includes('locality')) city = component.long_name;
        if (types.includes('postal_town') && !city) city = component.long_name;
        if (types.includes('administrative_area_level_1')) state = component.short_name;
        if (types.includes('postal_code')) zip = component.short_name;
        if (types.includes('country')) country = component.long_name;
    }

    let address = `${streetNumber} ${route}`.trim();
    if (!address && formatted) address = String(formatted).split(',')[0] || '';
    return { address, city, state, zip, country };
}

const AddressAutocomplete: React.FC<Props> = ({
    value,
    onChange,
    onAddressSelect,
    placeholder = "Search address...",
    className,
    disabled,
    inputVariant,
    componentRestrictions,
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const placesAttrDivRef = useRef<HTMLDivElement | null>(null);
    const sessionTokenRef = useRef<unknown>(null);
    const lastFetchedRef = useRef<string>('');
    const userEditedRef = useRef<boolean>(false);
    const lastUserInputRef = useRef<string>('');
    // Set to the value(s) currently in the field as a result of a programmatic
    // selection (callers like PolicyHolderStep frequently overwrite our
    // formatted value with just the street portion, so we have to remember
    // both shapes). While `justSelectedRef` is true we suppress fetching so
    // the dropdown doesn't immediately reopen on the value-change cascade.
    const justSelectedRef = useRef<boolean>(false);
    const selectedValuesRef = useRef<Set<string>>(new Set());

    const [isScriptLoaded, setIsScriptLoaded] = useState(false);
    const [authFailed, setAuthFailed] = useState<boolean>(() => googleMapsAuthFailed);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(-1);

    const onChangeRef = useRef(onChange);
    const onAddressSelectRef = useRef(onAddressSelect);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    useEffect(() => { onAddressSelectRef.current = onAddressSelect; }, [onAddressSelect]);

    useEffect(() => {
        if (!disabled) return;
        userEditedRef.current = false;
        setSuggestions([]);
        setIsOpen(false);
        setHighlightIndex(-1);
    }, [disabled]);

    useEffect(() => {
        const trimmed = (value || '').trim();
        if (!justSelectedRef.current && trimmed !== lastUserInputRef.current.trim()) {
            userEditedRef.current = false;
        }
    }, [value]);

    useEffect(() => {
        installGlobalAuthFailureHook();
        if (googleMapsAuthFailed) {
            setAuthFailed(true);
            return;
        }
        const notify = () => setAuthFailed(true);
        authFailureSubscribers.add(notify);
        return () => { authFailureSubscribers.delete(notify); };
    }, []);

    // --- Step 1: Load the Google Maps JS once globally -------------------
    useEffect(() => {
        if (authFailed) return;
        const isReady = () => Boolean(window.google?.maps?.places);
        if (isReady()) {
            setIsScriptLoaded(true);
            return;
        }

        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
            logger.warn('[Google Maps] VITE_GOOGLE_MAPS_API_KEY missing — running in plain input mode.');
            return;
        }

        let script = document.querySelector('script[src*="maps.googleapis.com"]') as HTMLScriptElement | null;
        if (!script) {
            // `appendChild` synchronously triggers the script load in
            // some test environments (happy-dom, jsdom-with-script-loading
            // disabled), where it can throw `NotSupportedError: JavaScript
            // file loading is disabled`. That exception used to bubble out
            // of the effect and unmount the surrounding form, breaking
            // unrelated tests (the dob-hydration regression suite among
            // them). Wrap in try/catch so the component degrades to plain
            // input mode instead of taking the tree down with it.
            try {
                script = document.createElement('script');
                script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async&v=weekly`;
                script.async = true;
                script.defer = true;
                document.head.appendChild(script);
            } catch (err) {
                logger.warn({ err }, '[Google Maps] Failed to inject loader script; falling back to plain input.');
                return;
            }
        }

        const interval = window.setInterval(() => {
            if (isReady()) {
                window.clearInterval(interval);
                setIsScriptLoaded(true);
            }
        }, 100);

        const giveUp = window.setTimeout(() => {
            if (!isReady()) {
                window.clearInterval(interval);
                logger.warn('[Google Maps] Script did not become ready within 8s; address autocomplete disabled.');
            }
        }, 8000);

        return () => {
            window.clearInterval(interval);
            window.clearTimeout(giveUp);
        };
    }, [authFailed]);

    // --- Step 2: Fetch suggestions whenever the typed value changes ------
    // Debounced + suppressed for the brief window after a selection so the
    // dropdown doesn't immediately reopen when the parent form rewrites the
    // field value (PolicyHolderStep, for example, overwrites our formatted
    // address with just the street portion via `setValue('address.line1')`).
    useEffect(() => {
        if (authFailed || !isScriptLoaded || disabled) return;
        const trimmed = (value || '').trim();
        if (!userEditedRef.current || trimmed.length < 3) {
            setSuggestions([]);
            setIsOpen(false);
            return;
        }
        if (justSelectedRef.current || selectedValuesRef.current.has(trimmed)) {
            setSuggestions([]);
            setIsOpen(false);
            return;
        }

        let cancelled = false;
        const handle = window.setTimeout(async () => {
            const places = window.google?.maps?.places;
            if (!places) return;
            lastFetchedRef.current = trimmed;

            // Try the modern `AutocompleteSuggestion` API first. As of
            // 2026-03 Google blocks the legacy `AutocompleteService` for
            // any API key issued after 2025-03 — the call still resolves
            // with HTTP 200 but predictions come back null with a
            // deprecation error in the console, which previously left the
            // dropdown silently empty for every customer on a current key
            // (production cy4 was in this state until this change).
            // Falling back to legacy only when the modern path is genuinely
            // unavailable preserves the original "old staging keys still
            // work" intent of commit `02db9d23` without breaking new keys.
            //
            // ABY-299: when `componentRestrictions` is provided, both API
            // paths constrain suggestions to the listed ISO country codes
            // (modern → `includedRegionCodes`, legacy → `componentRestrictions.country`)
            // so customer-facing wizards on `abbeygate-{cy,pt,gr,es}` no
            // longer surface USA / international results.
            const restrictionCountries = (componentRestrictions ?? [])
                .map((code) => String(code || '').trim().toUpperCase())
                .filter((code) => /^[A-Z]{2}$/.test(code))
                .slice(0, 5);
            const tryClassicService = (): boolean => {
                if (!places.AutocompleteService) return false;
                try {
                    const service = new places.AutocompleteService();
                    service.getPlacePredictions(
                        {
                            input: trimmed,
                            sessionToken: sessionTokenRef.current,
                            ...(restrictionCountries.length > 0
                                ? { componentRestrictions: { country: restrictionCountries } }
                                : {}),
                        },
                        (preds, status) => {
                            if (cancelled || lastFetchedRef.current !== trimmed) return;
                            const ok = String(status || '').trim().toUpperCase();
                            if (ok && ok !== AUTOCOMPLETE_OK_STATUS && ok !== AUTOCOMPLETE_NO_MATCHES_STATUS) {
                                logger.warn({ status: ok }, '[Google Maps] AutocompleteService rejected request');
                                return;
                            }
                            const list: Suggestion[] = (preds || [])
                                .slice(0, 6)
                                .map((p) => ({
                                    placeId: p.place_id,
                                    primary: p.structured_formatting?.main_text || p.description,
                                    secondary: p.structured_formatting?.secondary_text || '',
                                }));
                            setSuggestions(list);
                            setIsOpen(list.length > 0);
                        },
                    );
                    return true;
                } catch (err) {
                    logger.warn({ err }, '[Google Maps] AutocompleteService threw');
                    return false;
                }
            };

            try {
                if (places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
                    if (!sessionTokenRef.current && places.AutocompleteSessionToken) {
                        sessionTokenRef.current = new places.AutocompleteSessionToken();
                    }
                    try {
                        const result = await places.AutocompleteSuggestion!.fetchAutocompleteSuggestions({
                            input: trimmed,
                            sessionToken: sessionTokenRef.current,
                            ...(restrictionCountries.length > 0
                                ? { includedRegionCodes: restrictionCountries }
                                : {}),
                        });
                        if (cancelled || lastFetchedRef.current !== trimmed) return;
                        const list: Suggestion[] = (result?.suggestions || [])
                            .map((s): Suggestion | null => {
                                const p = s.placePrediction;
                                if (!p?.placeId) return null;
                                const primary = p.mainText?.text || p.text?.text || '';
                                const secondary = p.secondaryText?.text || '';
                                return { placeId: p.placeId, primary, secondary };
                            })
                            .filter((s): s is Suggestion => s !== null)
                            .slice(0, 6);
                        setSuggestions(list);
                        setIsOpen(list.length > 0);
                        return;
                    } catch (modernErr) {
                        // Modern API exists in `places` but rejected this
                        // request (commonly: Places API (New) not enabled on
                        // the project, or referer not allow-listed). Try the
                        // classic-API fallback so the customer still sees
                        // suggestions instead of a dead input.
                        logger.warn({ err: modernErr }, '[Google Maps] AutocompleteSuggestion failed; falling back to AutocompleteService');
                        if (tryClassicService()) return;
                        return;
                    }
                }

                tryClassicService();
            } catch (err) {
                logger.warn({ err }, '[Google Maps] Failed to fetch autocomplete suggestions');
            }
        }, 200);

        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [authFailed, disabled, isScriptLoaded, value, componentRestrictions]);

    // --- Step 3: When a suggestion is picked, fetch its full address. ----
    const selectSuggestion = useCallback(async (placeId: string) => {
        const places = window.google?.maps?.places;
        if (!places) return;
        setIsOpen(false);
        setHighlightIndex(-1);

        const finalize = (formatted: string, components: GoogleAddressComponent[]) => {
            const data = extractAddressFromComponents(components, formatted);
            const display = formatted || data.address;
            // Remember every shape the field might end up holding after the
            // value-change cascade settles (callers may push either the
            // formatted address or just the street component).
            selectedValuesRef.current = new Set(
                [display, data.address, formatted].filter(Boolean).map((s) => s.trim()),
            );
            justSelectedRef.current = true;
            userEditedRef.current = false;
            if (display) onChangeRef.current(display);
            onAddressSelectRef.current(data);
            sessionTokenRef.current = null; // reset for billing — one token per session
        };

        // Same modern-first / classic-API-fallback ordering as the
        // suggestions fetch above (see comment there). `PlacesService.getDetails`
        // is silently broken on post-2025-03 keys; the modern `Place`
        // class is Google's recommended path. Falling back only when the
        // modern path is genuinely missing keeps old keys working.
        const tryClassicDetails = (): boolean => {
            if (!places.PlacesService) return false;
            try {
                if (!placesAttrDivRef.current) {
                    placesAttrDivRef.current = document.createElement('div');
                }
                const service = new places.PlacesService(placesAttrDivRef.current);
                service.getDetails(
                    {
                        placeId,
                        fields: ['address_components', 'formatted_address'],
                        sessionToken: sessionTokenRef.current,
                    },
                    (place, status) => {
                        const ok = String(status || '').trim().toUpperCase();
                        if (ok && ok !== AUTOCOMPLETE_OK_STATUS) {
                            logger.warn({ status: ok }, '[Google Maps] PlacesService.getDetails rejected request');
                            return;
                        }
                        if (!place) return;
                        finalize(
                            String(place.formatted_address || ''),
                            place.address_components || [],
                        );
                    },
                );
                return true;
            } catch (err) {
                logger.warn({ err }, '[Google Maps] PlacesService.getDetails threw');
                return false;
            }
        };

        try {
            if (places.Place) {
                try {
                    const place = new places.Place({ id: placeId });
                    if (place.fetchFields) {
                        await place.fetchFields({ fields: ['formattedAddress', 'addressComponents'] });
                    }
                    const components: GoogleAddressComponent[] = (place.addressComponents || []).map((c) => ({
                        long_name: String(c.longText || ''),
                        short_name: String(c.shortText || ''),
                        types: Array.isArray(c.types) ? c.types : [],
                    }));
                    finalize(String(place.formattedAddress || ''), components);
                    return;
                } catch (modernErr) {
                    logger.warn({ err: modernErr }, '[Google Maps] Place.fetchFields failed; falling back to PlacesService');
                    if (tryClassicDetails()) return;
                    return;
                }
            }

            tryClassicDetails();
        } catch (err) {
            logger.warn({ err }, '[Google Maps] Failed to fetch place details');
        }
    }, []);

    // --- Step 4: Close dropdown on outside click. ------------------------
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (!wrapperRef.current?.contains(e.target as Node)) {
                setIsOpen(false);
                setHighlightIndex(-1);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    // --- Step 5: Reset highlight when suggestions change. ----------------
    useEffect(() => {
        setHighlightIndex(-1);
    }, [suggestions]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return;
        const next = e.target.value;
        // The user is typing again — re-arm fetching. We can't compare
        // against value here (it's the previous render's value); the act of
        // firing this handler is itself proof the user touched the field.
        justSelectedRef.current = false;
        userEditedRef.current = true;
        lastUserInputRef.current = next;
        selectedValuesRef.current = new Set();
        onChange(next);
    };

    const handleBlur = () => {
        // Use a short delay so onMouseDown on a suggestion still has time to
        // fire (mousedown.preventDefault keeps the input focused, but
        // belt-and-braces: leaving the field for any reason should hide the
        // dropdown).
        window.setTimeout(() => {
            if (!wrapperRef.current?.contains(document.activeElement)) {
                setIsOpen(false);
                setHighlightIndex(-1);
            }
        }, 120);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen || suggestions.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex((i) => (i + 1) % suggestions.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        } else if (e.key === 'Enter') {
            if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
                e.preventDefault();
                void selectSuggestion(suggestions[highlightIndex].placeId);
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false);
            setHighlightIndex(-1);
        }
    };

    const resolvedVariant: React.ComponentProps<typeof Input>['variant'] =
        inputVariant || (String(className || '').includes('ui-input') ? 'ui' : 'default');

    return (
        <div ref={wrapperRef} className="relative">
            <Input
                ref={inputRef}
                variant={resolvedVariant}
                className={className}
                placeholder={placeholder}
                value={value}
                onChange={handleInputChange}
                onFocus={() => {
                    if (disabled) return;
                    // Re-opening on focus is only safe when the visible value
                    // is still genuinely user-typed; after a selection the
                    // suggestions list is stale.
                    if (userEditedRef.current && !justSelectedRef.current && suggestions.length > 0) {
                        setIsOpen(true);
                    }
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                autoComplete="off"
            />

            {isOpen && suggestions.length > 0 && !authFailed && !disabled && (
                <ul
                    role="listbox"
                    className="absolute left-0 right-0 top-full z-[10500] mt-1 max-h-72 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-2px_rgba(0,0,0,0.05)]"
                >
                    {suggestions.map((s, i) => {
                        const active = i === highlightIndex;
                        return (
                            <li
                                key={s.placeId}
                                role="option"
                                aria-selected={active}
                                className={[
                                    'flex cursor-pointer items-start gap-3 px-4 py-3 text-sm transition-colors',
                                    i > 0 ? 'border-t border-slate-100' : '',
                                    active ? 'bg-brand-primary/5' : 'hover:bg-slate-50',
                                ].join(' ')}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    void selectSuggestion(s.placeId);
                                }}
                                onMouseEnter={() => setHighlightIndex(i)}
                            >
                                <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate font-semibold text-slate-700">{s.primary}</div>
                                    {s.secondary && (
                                        <div className="truncate text-xs text-slate-500">{s.secondary}</div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                    <li className="flex items-center justify-end border-t border-slate-100 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-400">
                        powered by Google
                    </li>
                </ul>
            )}
        </div>
    );
};

export default AddressAutocomplete;
