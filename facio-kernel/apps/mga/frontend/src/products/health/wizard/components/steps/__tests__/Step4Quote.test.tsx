/* @vitest-environment happy-dom */
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { Step4Quote } from '../Step4Quote';

type MotionDivProps = ComponentPropsWithoutRef<'div'> & {
  children?: ReactNode;
  whileHover?: unknown;
  initial?: unknown;
  animate?: unknown;
  exit?: unknown;
  variants?: unknown;
  transition?: unknown;
  custom?: unknown;
};

function MotionDiv(props: MotionDivProps) {
  const { whileHover, initial, animate, exit, variants, transition, custom, ...rest } = props;
  void whileHover;
  void initial;
  void animate;
  void exit;
  void variants;
  void transition;
  void custom;
  return <div {...rest}>{rest.children}</div>;
}

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => MotionDiv,
    },
  ),
}));

function Harness({
  children,
  ghsBeneficiary,
}: {
  children: ReactNode;
  ghsBeneficiary: boolean;
}) {
  const form = useForm({
    defaultValues: {
      ghs: { isBeneficiary: ghsBeneficiary },
      insureds: {
        persons: [{ firstName: 'Ada', lastName: 'Lovelace' }],
      },
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

const quotedResponse = {
  status: 'QUOTED',
  primaryOption: {
    annualPremium: 175,
    breakdown: {
      grossPremium: 175,
      lines: [
        { code: 'base.insured.0', label: 'Premium — Ada Lovelace (age 39)', amount: 175 },
        { code: 'total', label: 'Total', amount: 175 },
      ],
    },
  },
};

describe('Health Step4Quote cover summary (ABY-543)', () => {
  it('shows inpatient, outpatient and repatriation in base cover for non-GESY applicants', () => {
    render(
      <Harness ghsBeneficiary={false}>
        <Step4Quote quoteResponse={quotedResponse} rating={false} onContinue={() => undefined} />
      </Harness>,
    );

    expect(screen.getByText('Base cover')).toBeInTheDocument();
    expect(screen.getByText('Inpatient care')).toBeInTheDocument();
    expect(screen.getByText('Outpatient care')).toBeInTheDocument();
    expect(screen.getByText('Transportation of remains')).toBeInTheDocument();
    const outpatientTile = screen.getByText('Outpatient care').closest('.p-4');
    expect(outpatientTile?.textContent).not.toMatch(/GESY only/i);
  });

  it('keeps doctor visits & medications as GESY-only extended cover', () => {
    render(
      <Harness ghsBeneficiary={false}>
        <Step4Quote quoteResponse={quotedResponse} rating={false} onContinue={() => undefined} />
      </Harness>,
    );

    expect(screen.getByText('Doctor visits & medications')).toBeInTheDocument();
    expect(screen.getByText('GESY only')).toBeInTheDocument();
  });
});
