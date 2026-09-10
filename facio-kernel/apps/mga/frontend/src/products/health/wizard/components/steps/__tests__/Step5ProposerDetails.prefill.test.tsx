/* @vitest-environment happy-dom */
/**
 * ABY-292 regression: when a customer reaches the health "Your details"
 * step, the proposer fields that have a counterpart on the lead
 * insured (`insureds.persons[0]`) MUST be pre-filled — and pre-filled
 * non-destructively (existing values are preserved). The mapping
 * crosses one shape boundary: the insured's `dob` becomes the
 * proposer's `dateOfBirth`.
 *
 * This pins:
 *   - empty proposer fields are filled from insured[0]
 *   - stale counterpart values are refreshed when proposer identity
 *     still matches the lead insured
 *   - already-typed proposer values are NEVER clobbered
 *   - dob → dateOfBirth shape rename is honoured
 *   - whitespace-only insured values do not pollute proposer
 *   - email and phone on the lead insured sync to empty proposer fields
 *   - fields without a counterpart on the insured (address.*) are NOT touched
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { Step5ProposerDetails } from '../Step5ProposerDetails';

type FormShape = {
  insureds?: { persons?: Array<Record<string, unknown>> };
  proposer?: Record<string, unknown>;
  declarations?: Record<string, unknown>;
};

function Harness({ initial, onCommit }: { initial: FormShape; onCommit: (state: FormShape) => void }) {
  const form = useForm<FormShape>({ defaultValues: initial });
  // After the prefill effect runs, capture the form's current state
  // for the assertion. We lean on a microtask defer so the effect's
  // setValue calls have flushed by the time we read.
  setTimeout(() => onCommit(form.getValues()), 0);
  return (
    <FormProvider {...form}>
      <Step5ProposerDetails />
    </FormProvider>
  );
}

async function renderAndCapture(initial: FormShape): Promise<FormShape> {
  let captured: FormShape = {};
  render(<Harness initial={initial} onCommit={(state) => { captured = state; }} />);
  // Two ticks: one for setTimeout(0), one for any pending effects.
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  return captured;
}

describe('Step5ProposerDetails — proposer prefill from lead insured (ABY-292)', () => {
  it('fills empty proposer fields from insureds.persons[0] including dob → dateOfBirth', async () => {
    const result = await renderAndCapture({
      insureds: {
        persons: [
          {
            firstName: 'Effie',
            lastName: 'Pavlou',
            dob: '1985-04-20',
            gender: 'female',
            idType: 'passport',
            idNumber: 'CY-12345678',
            occupation: 'student',
          },
        ],
      },
      proposer: {},
    });

    expect(result.proposer?.firstName).toBe('Effie');
    expect(result.proposer?.lastName).toBe('Pavlou');
    expect(result.proposer?.dateOfBirth).toBe('1985-04-20');
    expect(result.proposer?.gender).toBe('female');
    expect(result.proposer?.idType).toBe('passport');
    expect(result.proposer?.idNumber).toBe('CY-12345678');
    expect(result.proposer?.occupation).toBe('student');
  });

  it('does NOT overwrite proposer fields the operator already typed', async () => {
    const result = await renderAndCapture({
      insureds: {
        persons: [
          {
            firstName: 'Effie',
            lastName: 'Pavlou',
            dob: '1985-04-20',
            gender: 'female',
            idType: 'passport',
            idNumber: 'CY-12345678',
            occupation: 'student',
          },
        ],
      },
      proposer: {
        firstName: 'Andreas',
        lastName: 'Demetriou',
        dateOfBirth: '1972-11-03',
        occupation: 'employed',
      },
    });

    expect(result.proposer?.firstName).toBe('Andreas');
    expect(result.proposer?.lastName).toBe('Demetriou');
    expect(result.proposer?.dateOfBirth).toBe('1972-11-03');
    expect(result.proposer?.occupation).toBe('employed');
    // Empty fields still get filled from the lead insured.
    expect(result.proposer?.gender).toBe('female');
    expect(result.proposer?.idType).toBe('passport');
    expect(result.proposer?.idNumber).toBe('CY-12345678');
  });

  it('updates stale proposer occupation when the proposer still matches the lead insured', async () => {
    const result = await renderAndCapture({
      insureds: {
        persons: [
          {
            firstName: 'Yuva',
            lastName: 'Oren',
            dob: '2007-11-20',
            gender: 'male',
            idType: 'passport',
            idNumber: '216599266',
            occupation: 'retired',
          },
        ],
      },
      proposer: {
        firstName: 'Yuva',
        lastName: 'Oren',
        dateOfBirth: '2007-11-20',
        gender: 'male',
        idType: 'passport',
        idNumber: '216599266',
        occupation: 'student',
      },
    });

    expect(result.proposer?.occupation).toBe('retired');
  });

  it('ignores whitespace-only insured fields (so proposer stays empty rather than being filled with junk)', async () => {
    const result = await renderAndCapture({
      insureds: {
        persons: [
          {
            firstName: '   ',
            lastName: '',
            dob: '   ',
            gender: 'female',
            idType: 'passport',
            idNumber: 'CY-99',
            occupation: 'student',
          },
        ],
      },
      proposer: {},
    });

    expect(result.proposer?.firstName ?? '').toBe('');
    expect(result.proposer?.lastName ?? '').toBe('');
    expect(result.proposer?.dateOfBirth ?? '').toBe('');
    expect(result.proposer?.gender).toBe('female');
    expect(result.proposer?.idType).toBe('passport');
    expect(result.proposer?.idNumber).toBe('CY-99');
    expect(result.proposer?.occupation).toBe('student');
  });

  it('syncs lead insured email and phone to empty proposer fields (ABY-517)', async () => {
    const result = await renderAndCapture({
      insureds: {
        persons: [
          {
            firstName: 'Effie',
            lastName: 'Pavlou',
            email: 'effie@example.com',
            phone: '+35799111224',
          },
        ],
      },
      proposer: {},
    });

    expect(result.proposer?.email).toBe('effie@example.com');
    expect(result.proposer?.phone).toBe('+35799111224');
  });

  it('does NOT touch proposer address fields that have no counterpart on the insured', async () => {
    const result = await renderAndCapture({
      insureds: {
        persons: [{ firstName: 'Effie', lastName: 'Pavlou', dob: '1985-04-20' }],
      },
      proposer: {
        address: { line1: '' },
      },
    });

    expect((result.proposer?.address as { line1?: string } | undefined)?.line1 ?? '').toBe('');
  });

  it('renders without crashing when there is no lead insured at all (no persons array yet)', async () => {
    const result = await renderAndCapture({
      insureds: {},
      proposer: { firstName: 'Solo' },
    });

    expect(result.proposer?.firstName).toBe('Solo');
    expect(result.proposer?.lastName ?? '').toBe('');
    expect(result.proposer?.dateOfBirth ?? '').toBe('');
  });
});

// Mock framer-motion just in case any sub-components reach for it.
vi.mock('framer-motion', () => {
  return {
    motion: new Proxy({}, { get: () => ({ children }: { children: unknown }) => children }),
  };
});
