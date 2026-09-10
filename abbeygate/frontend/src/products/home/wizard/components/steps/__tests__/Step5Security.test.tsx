/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Step5Security } from '../Step5Security';

function Harness({ children }: { children: ReactNode }) {
  const form = useForm({
    defaultValues: {
      security: { hasAlarm: undefined, alarmType: '', hasLocks: undefined, notes: '' },
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Home Step5Security', () => {
  it('renders the security section card', () => {
    render(<Harness><Step5Security /></Harness>);
    expect(screen.queryAllByText(/security/i).length).toBeGreaterThan(0);
  });

  it('renders clearer wording without weakening the security declarations (ABY-460)', () => {
    render(<Harness><Step5Security /></Harness>);
    expect(
      screen.getByText('Do all main external doors have a five-lever mortice or multi-lever deadlock (BS 3621 or local equivalent), and do all other external or patio doors have equivalent locks, key-operated security devices, or top-and-bottom bolts?'),
    ).toBeTruthy();
    expect(
      screen.getByText('Do all easily accessible windows have key-operated locks, securely locked shutters, or metal grilles embedded into the wall?'),
    ).toBeTruthy();
  });
});
