/* @vitest-environment happy-dom */
/**
 * Regression test for the FormField layout contract across
 * ABY-82 / ABY-83 / ABY-95 / ABY-96 / ABY-104 / ABY-105.
 *
 * Final shape (and the trade-off the team accepted):
 *   - LABEL is TOP-anchored, no flex-grow, no justify-end.
 *   - CONTROL block sits a constant `mt-2` below the label.
 *   - Outer cell takes its natural height (no `h-full`, no `flex` on
 *     the outer wrapper). CSS Grid stretches cells in a row by default,
 *     but content stays top-anchored, so a validation error appearing
 *     in cell A NEVER pushes label B around (ABY-104 "label jumps down
 *     with no clear reason", ABY-105 "identify the vehicle jumps up").
 *   - Trade-off: controls are no longer forced to baseline-align
 *     across a side-by-side grid row when siblings have different
 *     label line counts (the original ABY-82/83 aesthetic). The
 *     downstream consequences (ABY-95/96/104) outweighed that
 *     preference.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { FormField } from '../FormField';

function Harness({ children }: { children: React.ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('FormField layout contract (ABY-82/83/95/96/104/105)', () => {
  it('uses a top-anchored label without flex-grow / justify-end (ABY-104: no jumping on sibling validation)', () => {
    const { getByText } = render(
      <Harness>
        <FormField label="Label" fieldKey="thing">
          <input data-testid="input" />
        </FormField>
      </Harness>,
    );
    const labelEl = getByText('Label');
    // The label MUST be a direct child of the outer wrapper — no
    // intermediate `flex grow … justify-end` slot. Re-introducing
    // that slot would re-introduce ABY-104 / ABY-105.
    const labelParent = labelEl.parentElement as HTMLElement;
    expect(labelParent.getAttribute('data-field')).toBe('thing');
    expect(labelParent.className).not.toContain('grow');
    expect(labelParent.className).not.toContain('justify-end');
  });

  it('keeps a constant `mt-2` gap between label and control (ABY-95/96: consistent across rows / mobile / stand-alone)', () => {
    const { getByTestId } = render(
      <Harness>
        <FormField label="Label" fieldKey="thing">
          <input data-testid="input" />
        </FormField>
      </Harness>,
    );
    const childrenWrapper = getByTestId('input').parentElement as HTMLElement;
    expect(childrenWrapper.className).toContain('mt-2');
    // The legacy `mt-auto` collapsed the gap on stand-alone rows.
    expect(childrenWrapper.className).not.toContain('mt-auto');
  });

  it('outer wrapper does NOT use `h-full` / `flex` — content stays top-anchored regardless of row stretch (ABY-104)', () => {
    const { container } = render(
      <Harness>
        <FormField label="Some label" fieldKey="thing">
          <input data-testid="input" />
        </FormField>
      </Harness>,
    );
    const outer = container.querySelector('[data-field="thing"]') as HTMLElement;
    expect(outer.className).toContain('mb-6');
    expect(outer.className).not.toContain('h-full');
    expect(outer.className).not.toContain('flex');
  });

  it('preserves long-label content (no truncation / line-clamp — wraps naturally)', () => {
    const longLabel = 'Are all external doors fitted with key operated locks (standard or local equivalent)?';
    const { getByText } = render(
      <Harness>
        <FormField label={longLabel} fieldKey="security.doorsFiveLeverLocks">
          <input />
        </FormField>
      </Harness>,
    );
    expect(getByText(longLabel)).toBeTruthy();
  });
});
