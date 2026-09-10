/* @vitest-environment happy-dom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Step4Quote } from './Step4Quote';
import type { QuoteData, QuoteResponse } from '../../types';

type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode } & Record<string, unknown>;

function MotionDiv(props: MotionDivProps) {
  const {
    whileHover,
    initial,
    animate,
    exit,
    variants,
    transition,
    custom,
    ...rest
  } = props;
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
    }
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../Button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => <button {...props}>{props.children}</button>,
}));

vi.mock('../EmailOtpVerifyModal', () => ({
  EmailOtpVerifyModal: () => null,
}));

vi.mock('@/src/shared/lib/wizard', async () => {
  const actual = await vi.importActual<typeof import('@/src/shared/lib/wizard')>('@/src/shared/lib/wizard');
  return {
    ...actual,
    QuoteLoading: () => <div>loading...</div>,
  };
});

describe('Step4Quote network behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests recommendations then preview rates on first render', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/recommendations')) {
        return new Response(JSON.stringify({ success: true, data: { recommendations: [] } }), { status: 200 });
      }

      if (url.includes('/rate')) {
        const bodyRaw = String(init?.body || '{}');
        const body = JSON.parse(bodyRaw);
        const selected = ((body?.coverageSelection?.selected || {})) as Record<string, boolean>;
        const isVip = Boolean(selected['COV-ROADSIDE-VIP']);
        const isNcb = Boolean(selected['CV 172']);
        const annual = isVip ? 905 : isNcb ? 915 : 870;
        return new Response(JSON.stringify({ success: true, data: { primaryOption: { annualPremium: annual } } }), { status: 200 });
      }

      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const quote: QuoteResponse = {
      status: 'quoted',
      reference: 'ABQ100',
      validUntil: new Date().toISOString(),
      currency: 'EUR',
      alternatives: [],
      warnings: [],
      primaryOption: {
        name: 'Comprehensive',
        annualPremium: 870,
        totalExcess: 500,
        voluntaryExcess: 500,
        breakdown: {
          tplBase: 100,
          tplClaimsFactor: 1,
          tplMileageFactor: 1,
          tplLicenseFactor: 1,
          tplFinal: 100,
          compBase: 700,
          compAgeFactor: 1,
          compClaimsFactor: 1,
          compExcessFactor: 1,
          compLicenseFactor: 1,
          compFinal: 700,
          windscreen: 70,
          finalPremium: 870,
        },
        costDetails: {
          grossPremium: 870,
          ncdAmount: 0,
          onlineDiscount: 0,
          subtotalNetPremium: 870,
          mifSurcharge: 0,
          tax: 0,
          policyFee: 0,
          totalPremium: 870,
        },
        calculationTrace: { steps: [] },
      },
    };

    const data: QuoteData = {
      proposer: {
        firstName: 'Test',
        lastName: 'User',
        address: {
          line1: 'Main street',
          city: 'Nicosia',
          province: 'Nicosia',
          postcode: '1010',
          country: 'Cyprus',
        },
        nationality: 'Cyprus',
        nif: '12345678A',
        occupation: 'Engineer',
        whereDidYouHear: 'Web',
        marketingConsent: false,
        privacyPolicyAccepted: true,
        dateOfBirth: '1990-01-01',
        email: 'test@example.com',
      },
      licenseType: 'Full',
      licenseIssuedIn: 'CY',
      hasClaims: false,
      claimsDetails: '',
      claimsCountLast5Years: '',
      claimsTotalCostLast5Years: '',
      maxFaultClaimCostLast5Years: '',
      hasConvictions: false,
      convictionsDetails: '',
      hasMajorConvictionLast5Years: false,
      convictionClass: '',
      majorConvictionWithinYears: '',
      hasAdditionalDrivers: false,
      youngestDriverAge: '',
      otherDriversClaims: false,
      otherDriversClaimsDetails: '',
      otherDriversConvictions: false,
      otherDriversConvictionsDetails: '',
      vehicleLocation: 'CY',
      make: 'Nissan',
      model: 'Qashqai',
      vehicleType: 'car',
      motorcycleRidersNamed: null,
      classicIsGenuine: null,
      classicIsSecondaryVehicle: null,
      cabrio: 'No',
      year: 2021,
      kmsPerYear: '10000',
      countryOfRegistration: 'CY',
      registrationNumber: 'KAA123',
      vin: '',
      numberOfSeats: 5,
      modified: false,
      modificationsDetails: '',
      parking: 'garage',
      parkingOther: '',
      fuelType: 'Diesel',
      engineSize: 1600,
      vehicleValue: 25000,
      ncb: '0',
      protectNCB: false,
      vehicleUse: 'social',
      requiredExcess: '€500',
      coverRequired: 'Comprehensive',
      renewalDate: '2026-03-04',
      licenseYears: '10',
      infoTrueAndAccurate: true,
      fairProcessingAccepted: true,
    };

    render(
      <Step4Quote
        data={data}
        quote={quote}
        policyId="token-123"
        onRequestEdit={() => undefined}
        onProceedToPayment={() => undefined}
        onSelectedOptionNameChange={() => undefined}
        onRequestCall={async () => undefined}
        onRatedQuote={() => undefined}
      />
    );

    await waitFor(() => {
      const rateCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/rate'));
      const recCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/recommendations'));
      // Contract-level expectation: preview rating runs at least once,
      // while recommendation fetch remains a single initialization call.
      expect(rateCalls.length).toBeGreaterThanOrEqual(1);
      expect(recCalls.length).toBe(1);
      expect(screen.getByRole('link', { name: /Insurance Product Information Document/i })).toHaveAttribute(
        'href',
        '/api/public/ipid/motor',
      );
    }, { timeout: 8000 });
  }, 15000);

  it('shows the convertible mechanism additional excess when cabrio is selected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })));

    const quote: QuoteResponse = {
      status: 'quoted',
      reference: 'ABQ-CABRIO',
      validUntil: new Date().toISOString(),
      currency: 'EUR',
      alternatives: [],
      warnings: [],
      primaryOption: {
        name: 'Comprehensive',
        annualPremium: 870,
        totalExcess: 700,
        voluntaryExcess: 700,
        costDetails: {
          grossPremium: 870,
          ncdAmount: 0,
          onlineDiscount: 0,
          subtotalNetPremium: 870,
          mifSurcharge: 0,
          tax: 0,
          policyFee: 0,
          totalPremium: 870,
        },
        calculationTrace: { steps: [] },
      },
    };

    const data: QuoteData = {
      proposer: {
        firstName: 'Test',
        lastName: 'Driver',
        address: {
          line1: 'Main street',
          city: 'Nicosia',
          province: 'Nicosia',
          postcode: '1010',
          country: 'Cyprus',
        },
        nationality: 'Cyprus',
        nif: '12345678A',
        occupation: 'Engineer',
        whereDidYouHear: 'Web',
        marketingConsent: false,
        privacyPolicyAccepted: true,
        dateOfBirth: '1990-01-01',
        email: 'test@example.com',
      },
      licenseType: 'Full',
      licenseIssuedIn: 'CY',
      hasClaims: false,
      claimsDetails: '',
      claimsCountLast5Years: '',
      claimsTotalCostLast5Years: '',
      maxFaultClaimCostLast5Years: '',
      hasConvictions: false,
      convictionsDetails: '',
      hasMajorConvictionLast5Years: false,
      convictionClass: '',
      majorConvictionWithinYears: '',
      hasAdditionalDrivers: false,
      youngestDriverAge: '',
      otherDriversClaims: false,
      otherDriversClaimsDetails: '',
      otherDriversConvictions: false,
      otherDriversConvictionsDetails: '',
      vehicleLocation: 'CY',
      licenseYears: '10',
      make: 'Mazda',
      model: 'MX-5',
      vehicleType: 'car',
      motorcycleRidersNamed: null,
      classicIsGenuine: null,
      classicIsSecondaryVehicle: null,
      cabrio: 'Yes',
      year: 2021,
      kmsPerYear: '10000',
      countryOfRegistration: 'CY',
      registrationNumber: 'KAA123',
      vin: '',
      numberOfSeats: 2,
      modified: false,
      modificationsDetails: '',
      parking: 'garage',
      parkingOther: '',
      fuelType: 'Petrol',
      engineSize: 1800,
      vehicleValue: 25000,
      ncb: '0',
      protectNCB: false,
      vehicleUse: 'social',
      requiredExcess: '€700',
      coverRequired: 'Comprehensive',
      renewalDate: '2026-03-04',
      infoTrueAndAccurate: true,
      fairProcessingAccepted: true,
    };

    render(
      <Step4Quote
        data={data}
        quote={quote}
        policyId="token-cabrio"
        onRequestEdit={() => undefined}
        onProceedToPayment={() => undefined}
        onSelectedOptionNameChange={() => undefined}
        onRequestCall={async () => undefined}
        onRatedQuote={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Additional Excess 500 Euro, Applicable to convertible mechanism in its entirety.')).toBeTruthy();
    }, { timeout: 4000 });
  });
});
