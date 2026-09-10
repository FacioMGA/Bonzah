import { describe, expect, it } from 'vitest';
import { getHighlightedSelection, getNextHighlightedIndex } from './searchableSelectKeyboard';

describe('searchableSelectKeyboard', () => {
  it('moves the highlighted option down and wraps', () => {
    expect(getNextHighlightedIndex(-1, 3, 'down')).toBe(0);
    expect(getNextHighlightedIndex(0, 3, 'down')).toBe(1);
    expect(getNextHighlightedIndex(2, 3, 'down')).toBe(0);
  });

  it('moves the highlighted option up and wraps', () => {
    expect(getNextHighlightedIndex(-1, 3, 'up')).toBe(2);
    expect(getNextHighlightedIndex(2, 3, 'up')).toBe(1);
    expect(getNextHighlightedIndex(0, 3, 'up')).toBe(2);
  });

  it('returns no selection when Enter has no highlighted option', () => {
    expect(getHighlightedSelection(['a', 'b'], -1)).toBeNull();
    expect(getHighlightedSelection(['a', 'b'], 5)).toBeNull();
  });

  it('returns the currently highlighted option for Enter selection', () => {
    expect(getHighlightedSelection(['a', 'b', 'c'], 1)).toBe('b');
  });
});
