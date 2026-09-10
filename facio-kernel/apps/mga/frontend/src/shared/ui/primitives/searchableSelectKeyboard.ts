export function getNextHighlightedIndex(
  currentIndex: number,
  optionCount: number,
  direction: 'up' | 'down',
): number {
  if (optionCount <= 0) return -1;
  if (direction === 'down') {
    return currentIndex < 0 ? 0 : (currentIndex + 1) % optionCount;
  }
  return currentIndex < 0 ? optionCount - 1 : (currentIndex - 1 + optionCount) % optionCount;
}

export function getHighlightedSelection<T>(options: T[], highlightedIndex: number): T | null {
  if (highlightedIndex < 0 || highlightedIndex >= options.length) return null;
  return options[highlightedIndex] ?? null;
}
