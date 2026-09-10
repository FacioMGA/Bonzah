import type { SanctionSearchResult } from './sanctionsTypes.js';

export type SearchIndividualInput = {
  name: string;
  /**
   * Subject date of birth in Creditsafe-accepted form (`YYYY-MM-DD` or
   * `YYYY`). Screening is by name + DOB — country is deliberately NOT sent
   * because `countryCodes` filters the AML search and over-narrows results
   * (see ADR-0043). Omitted when the quote has no usable DOB, in which case
   * the search runs name-only (a valid Creditsafe mode).
   */
  dateOfBirth?: string;
  correlationId: string;
};

export type DownloadIndividualSearchPdfInput = {
  searchId: string;
  hitIds: string[];
};

export type SanctionPdfReport = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

export interface SanctionSearchProvider {
  searchIndividual(input: SearchIndividualInput): Promise<SanctionSearchResult>;
  /**
   * Fetch a binary PDF report for a previously executed search. Implementations
   * may resolve a temporary download URL from the provider and stream the
   * binary; the caller is responsible for persisting the buffer (e.g. via
   * `storageService.uploadFile`). Returns `null` when the provider cannot
   * produce a report (e.g. disabled provider stub) or no hit ids are supplied.
   */
  downloadIndividualSearchPdf(input: DownloadIndividualSearchPdfInput): Promise<SanctionPdfReport | null>;
}
