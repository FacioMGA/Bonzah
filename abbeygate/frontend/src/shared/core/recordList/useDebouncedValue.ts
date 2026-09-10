import { useEffect, useRef, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): { debounced: T; isDebouncing: boolean } {
  const [debounced, setDebounced] = useState<T>(value);
  const firstRef = useRef(true);

  useEffect(() => {
    // Avoid delaying first render / initial URL hydration.
    if (firstRef.current) {
      firstRef.current = false;
      setDebounced(value);
      return;
    }

    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [delayMs, value]);

  return { debounced, isDebouncing: debounced !== value };
}

