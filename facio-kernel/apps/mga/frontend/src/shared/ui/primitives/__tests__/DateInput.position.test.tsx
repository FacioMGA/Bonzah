/* @vitest-environment happy-dom */
/**
 * ABY-524 — the shared DateInput calendar must stay fully visible by
 * flipping above the field or constraining height when the viewport
 * edge is too close (reported on travel quote step=trip, Safari desktop).
 */
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_PANEL_ESTIMATED_HEIGHT,
  CALENDAR_VIEWPORT_PADDING,
  computeCalendarPanelStyle,
} from '../DateInput';

const panelWidth = 352;
const panelHeight = CALENDAR_PANEL_ESTIMATED_HEIGHT;

describe('computeCalendarPanelStyle (ABY-524)', () => {
  it('opens below the field when there is enough space underneath', () => {
    const style = computeCalendarPanelStyle({
      rect: { top: 120, bottom: 160, left: 100, right: 420 },
      panelWidth,
      panelHeight,
      viewportWidth: 1663,
      viewportHeight: 927,
      viewportPadding: CALENDAR_VIEWPORT_PADDING,
    });

    expect(style.top).toBe(168);
    expect(style.maxHeight).toBe(panelHeight);
    expect(style.overflowY).toBeUndefined();
  });

  it('opens above the field when the trigger sits near the viewport bottom', () => {
    const style = computeCalendarPanelStyle({
      rect: { top: 800, bottom: 840, left: 100, right: 420 },
      panelWidth,
      panelHeight,
      viewportWidth: 1663,
      viewportHeight: 927,
      viewportPadding: CALENDAR_VIEWPORT_PADDING,
    });

    expect(style.top).toBeLessThan(800);
    expect(Number(style.top) + Number(style.maxHeight)).toBeLessThanOrEqual(927 - CALENDAR_VIEWPORT_PADDING);
  });

  it('keeps the panel inside the viewport when forced open below with limited space', () => {
    const style = computeCalendarPanelStyle({
      rect: { top: 700, bottom: 740, left: 100, right: 420 },
      panelWidth,
      panelHeight,
      viewportWidth: 390,
      viewportHeight: 780,
      viewportPadding: CALENDAR_VIEWPORT_PADDING,
    });

    expect(Number(style.top) + Number(style.maxHeight)).toBeLessThanOrEqual(780 - CALENDAR_VIEWPORT_PADDING);
    expect(style.top).toBeGreaterThanOrEqual(CALENDAR_VIEWPORT_PADDING);
  });

  it('shrinks to the actual available height when neither side reaches the preferred minimum', () => {
    const style = computeCalendarPanelStyle({
      rect: { top: 160, bottom: 200, left: 20, right: 340 },
      panelWidth,
      panelHeight,
      viewportWidth: 390,
      viewportHeight: 360,
      viewportPadding: CALENDAR_VIEWPORT_PADDING,
    });

    expect(style.maxHeight).toBe(136);
    expect(style.overflowY).toBe('auto');
    expect(style.top).toBeGreaterThanOrEqual(CALENDAR_VIEWPORT_PADDING);
    expect(Number(style.top) + Number(style.maxHeight)).toBeLessThanOrEqual(360 - CALENDAR_VIEWPORT_PADDING);
  });

  it('aligns the panel to the right edge of the field without overflowing horizontally', () => {
    const style = computeCalendarPanelStyle({
      rect: { top: 200, bottom: 240, left: 1200, right: 1500 },
      panelWidth,
      panelHeight,
      viewportWidth: 1663,
      viewportHeight: 927,
      viewportPadding: CALENDAR_VIEWPORT_PADDING,
    });

    expect(style.left).toBe(1148);
    expect(Number(style.left) + panelWidth).toBeLessThanOrEqual(1663 - CALENDAR_VIEWPORT_PADDING);
  });
});
