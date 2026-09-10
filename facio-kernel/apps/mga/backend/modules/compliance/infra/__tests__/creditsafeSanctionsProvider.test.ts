import { describe, expect, it, vi } from 'vitest';
import { CreditsafeSanctionsProvider } from '../creditsafeSanctionsProvider.js';
import { CreditsafeClient } from '../creditsafeClient.js';
import type { CreditsafeHitRow, CreditsafeSearchResponse } from '../creditsafeClient.js';

function makeClient(args: {
  response?: CreditsafeSearchResponse;
  hits?: CreditsafeHitRow[];
}) {
  const searchResponse: CreditsafeSearchResponse = args.response ?? {
    id: 'search-1',
    totalHitCount: args.hits?.length ?? 0,
    status: 'complete',
    riskRating: 'low',
  };
  const hits = args.hits ?? [];
  const client = new CreditsafeClient({
    baseUrl: 'https://creditsafe.test',
    username: 'user',
    password: 'pass',
    timeoutMs: 1000,
    tokenTtlMs: 60_000,
  });
  const searchIndividuals = vi.spyOn(client, 'searchIndividuals').mockResolvedValue(searchResponse);
  const fetchIndividualSearchHits = vi.spyOn(client, 'fetchIndividualSearchHits').mockResolvedValue(hits);
  vi.spyOn(client, 'requestIndividualSearchPdf').mockRejectedValue(new Error('PDF not used in search tests'));
  vi.spyOn(client, 'fetchPdfBinary').mockRejectedValue(new Error('PDF not used in search tests'));

  return { client, searchIndividuals, fetchIndividualSearchHits };
}

function makeProvider(client: CreditsafeClient): CreditsafeSanctionsProvider {
  return new CreditsafeSanctionsProvider(client, {
    threshold: 90,
    datasets: ['SAN-CURRENT', 'INS', 'DD'],
  });
}

describe('CreditsafeSanctionsProvider', () => {
  it('blocks when a returned sanctions hit matches the customer DOB exactly', async () => {
    const { client } = makeClient({
      hits: [{
        id: 'hit-sanctions-dob',
        hitScore: 100,
        name: 'Listed Client',
        datesOfBirth: ['1980-01-01'],
        datasets: ['SAN-CURRENT'],
      }],
    });

    const result = await makeProvider(client).searchIndividual({
      name: 'Listed Client',
      dateOfBirth: '1980-01-01',
      correlationId: 'corr-1',
    });

    expect(result.blocking).toBe(true);
    expect(result.outcome).toBe('possible_match');
    expect(result.firstHit?.hitId).toBe('hit-sanctions-dob');
  });

  it('does not block when a name hit has a different DOB', async () => {
    const { client } = makeClient({
      hits: [{
        id: 'hit-different-dob',
        hitScore: 98,
        name: 'Listed Client',
        datesOfBirth: ['1970-01-01'],
        datasets: ['SAN-CURRENT'],
      }],
    });

    const result = await makeProvider(client).searchIndividual({
      name: 'Listed Client',
      dateOfBirth: '1980-01-01',
      correlationId: 'corr-2',
    });

    expect(result.blocking).toBe(false);
    expect(result.outcome).toBe('non_blocking_hit');
    expect(result.hitCount).toBe(1);
    expect(result.firstHit?.hitId).toBe('hit-different-dob');
  });

  it('does not block when a name hit returns no DOB', async () => {
    const { client } = makeClient({
      hits: [{
        id: 'hit-no-dob',
        hitScore: 98,
        name: 'Listed Client',
        datasets: ['PEP-LINKED'],
      }],
    });

    const result = await makeProvider(client).searchIndividual({
      name: 'Listed Client',
      dateOfBirth: '1980-01-01',
      correlationId: 'corr-3',
    });

    expect(result.blocking).toBe(false);
    expect(result.outcome).toBe('non_blocking_hit');
    expect(result.firstHit?.dateOfBirth).toBe('');
  });

  it('does not block when the exact-DOB hit is credit-only', async () => {
    const { client } = makeClient({
      hits: [{
        id: 'hit-credit-only',
        hitScore: 100,
        name: 'Listed Client',
        datesOfBirth: ['1980-01-01'],
        datasets: ['INS', 'DD'],
      }],
    });

    const result = await makeProvider(client).searchIndividual({
      name: 'Listed Client',
      dateOfBirth: '1980-01-01',
      correlationId: 'corr-4',
    });

    expect(result.blocking).toBe(false);
    expect(result.outcome).toBe('non_blocking_hit');
    expect(result.firstHit?.reasonsListed).toBe('INS, DD');
  });

  it('clears without fetching hit rows when Creditsafe returns no hits', async () => {
    const { client, fetchIndividualSearchHits } = makeClient({
      response: {
        id: 'search-clean',
        totalHitCount: 0,
        status: 'complete',
        riskRating: 'low',
      },
    });

    const result = await makeProvider(client).searchIndividual({
      name: 'Clear Client',
      dateOfBirth: '1980-01-01',
      correlationId: 'corr-5',
    });

    expect(result.blocking).toBe(false);
    expect(result.outcome).toBe('clear');
    expect(result.hitCount).toBe(0);
    expect(fetchIndividualSearchHits).not.toHaveBeenCalled();
  });

  it('fails closed when Creditsafe reports hits without a search id', async () => {
    const { client, fetchIndividualSearchHits } = makeClient({
      response: {
        totalHitCount: 1,
        status: 'complete',
        riskRating: 'high',
      },
    });

    const result = await makeProvider(client).searchIndividual({
      name: 'Unresolved Hit',
      dateOfBirth: '1980-01-01',
      correlationId: 'corr-6',
    });

    expect(result.blocking).toBe(true);
    expect(result.outcome).toBe('error');
    expect(result.hitCount).toBe(1);
    expect(fetchIndividualSearchHits).not.toHaveBeenCalled();
  });
});
