import { Router, type Response } from 'express';
import type {
  RentalCoverageDiscoveryRequest,
  RentalCoverageDiscoveryResponse,
  RentalPricePreviewRequest,
  RentalQuoteRequest,
  RentalQuoteResponse,
} from '@facio/products';

const DEFAULT_KERNEL_BASE_URL = 'https://platform.facio.io';
const DEFAULT_WORKSPACE_SLUG = 'bonzah-demo-fd24a745736e4e709ffc3c75438246e0';

class KernelPublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
    message: string,
  ) {
    super(message);
  }
}

function kernelBaseUrl(): string {
  return String(process.env.BONZAH_KERNEL_BASE_URL || DEFAULT_KERNEL_BASE_URL).replace(/\/$/, '');
}

function workspaceSlug(): string {
  return String(process.env.BONZAH_WORKSPACE_SLUG || DEFAULT_WORKSPACE_SLUG).trim();
}

async function kernelJson<T>(path: string, init: globalThis.RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Tenant-Slug', workspaceSlug());
  const response = await fetch(`${kernelBaseUrl()}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const body = payload as { error?: { message?: string } } | null;
    throw new KernelPublicApiError(
      response.status,
      payload,
      body?.error?.message || 'The Bonzah workspace could not complete the request.',
    );
  }
  return payload as T;
}

function sendKernelError(error: unknown, res: Response) {
  if (error instanceof KernelPublicApiError) {
    res.status(error.status).json(error.payload);
    return;
  }
  res.status(502).json({
    success: false,
    error: {
      code: 'KERNEL_PUBLIC_API_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'The Bonzah workspace is unavailable.',
    },
  });
}

function discoveryRequestFromPreview(
  input: RentalPricePreviewRequest,
): RentalCoverageDiscoveryRequest {
  return {
    pickup: input.pickup,
    residence: { country: 'US', state: input.pickup.state },
    rentalStart: input.rentalStart,
    rentalEnd: input.rentalEnd,
    driver: { age: 35, licenceValid: true },
    rentalUse: 'PERSONAL',
    vehicle: input.vehicle,
  };
}

export function createKernelRentalProxyRouter(): Router {
  const router = Router();

  router.post('/coverages', async (req, res) => {
    try {
      const data = await kernelJson<RentalCoverageDiscoveryResponse>(
        '/api/public/rental/coverages',
        {
          method: 'POST',
          body: JSON.stringify(req.body),
        },
      );
      res.json({ success: true, data });
    } catch (error) {
      sendKernelError(error, res);
    }
  });

  router.post('/price-preview', async (req, res) => {
    try {
      const input = req.body as RentalPricePreviewRequest;
      const data = await kernelJson<RentalCoverageDiscoveryResponse>(
        '/api/public/rental/coverages',
        {
          method: 'POST',
          body: JSON.stringify(discoveryRequestFromPreview(input)),
        },
      );
      const selected = new Set(input.coverages);
      const coverages = data.coverages.map((coverage) => ({
        code: coverage.code,
        label: coverage.label,
        selected: selected.has(coverage.code),
        dailyPrice: coverage.indicativeDailyPrice || 0,
        tripPrice: coverage.indicativeTripPrice || 0,
        limit: coverage.limit,
        deductible: coverage.deductible,
        description: coverage.description,
      }));
      const subtotal = coverages
        .filter((coverage) => coverage.selected)
        .reduce((sum, coverage) => sum + coverage.tripPrice, 0);
      res.json({
        success: true,
        data: {
          chargedPeriods: data.chargedPeriods || 0,
          vehicleMultiplier: 1,
          factors: [],
          ratingSource: data.ratingSource,
          coverages,
          subtotal,
          fees: data.fees,
          feeComponents: data.feeComponents,
          tax: 0,
          total: Math.round((subtotal + data.fees) * 100) / 100,
          currency: data.currency,
          demoStatus: data.demoStatus,
        },
      });
    } catch (error) {
      sendKernelError(error, res);
    }
  });

  router.post('/quotes', async (req, res) => {
    try {
      const request = req.body as RentalQuoteRequest;
      const created = await kernelJson<{
        success: true;
        data: { publicSessionToken: string; policyId: string };
      }>('/api/public/rental/session', {
        method: 'POST',
        body: JSON.stringify({ quoteData: request }),
      });
      const rated = await kernelJson<{ success: true; data: Record<string, unknown> }>(
        `/api/public/rental/session/${encodeURIComponent(created.data.publicSessionToken)}/rate`,
        { method: 'POST' },
      );
      const rating = rated.data as Record<string, unknown>;
      const data: RentalQuoteResponse = {
        ...(rating as unknown as RentalQuoteResponse),
        quoteId: created.data.publicSessionToken,
        riskSnapshot: request.risk,
        message: String(rating.eligibilityExplanation || 'Quote retained in the Bonzah workspace.'),
        customerExplanation: [String(rating.eligibilityExplanation || '')].filter(Boolean),
        ruleReferences: Array.isArray(rating.internalRuleReferences)
          ? rating.internalRuleReferences.map(String)
          : [],
        coverages: Array.isArray(rating.coveragePrices)
          ? (rating.coveragePrices as RentalQuoteResponse['coverages'])
          : [],
        currency: 'USD',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        correlationId: created.data.policyId,
        integrityToken: '',
        demoStatus: 'DEMO BUILD',
      };
      res.status(201).json({ success: true, data });
    } catch (error) {
      sendKernelError(error, res);
    }
  });

  router.get('/quotes/:quoteId', async (req, res) => {
    try {
      const session = await kernelJson<{ success: true; data: { quoteResponse?: unknown } }>(
        `/api/public/rental/session/${encodeURIComponent(req.params.quoteId)}`,
      );
      res.json({ success: true, data: session.data.quoteResponse || session.data });
    } catch (error) {
      sendKernelError(error, res);
    }
  });

  return router;
}
