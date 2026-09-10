/**
 * Submission Memory API Client — Org2Vec underwriting memory (ADR-0044).
 *
 * Reads the cached `SubmissionMemoryProjection`, enqueues a refresh, and
 * runs a read-only retrieval-grounded "ask". Postgres-only on read — never
 * queries Neo4j directly. The ask answer is always cited and the LLM cannot
 * mutate state or decide a gate.
 */
import { http } from '@/src/shared/api/http';
import type { UnknownRecord } from '@/src/shared/api/types';

export interface SubmissionMemoryCitation {
    threadId?: string;
    messageId?: string;
    documentId?: string;
    quote: string;
}

export interface SubmissionMemoryProjectionDto {
    summary: string | null;
    memoryObject: UnknownRecord;
    similarSubmissions: Array<{ submissionId: string; score: number; reasons?: Array<{ code: string; detail?: string }> }>;
    graphSignals: UnknownRecord;
    refreshStatus: 'pending' | 'refreshing' | 'fresh' | 'stale' | 'failed';
    refreshError: string | null;
    lastRefreshedAt: string | null;
    updatedAt: string;
}

export const submissionMemoryApiClient = {
    async getSubmissionMemory(submissionId: string) {
        return http.request<{
            submissionId: string;
            status: 'absent' | 'present';
            stalenessWarning: boolean;
            projection: SubmissionMemoryProjectionDto | null;
        }>(`policies/${submissionId}/submission-memory`);
    },

    async refreshSubmissionMemory(submissionId: string) {
        return http.request<{ submissionId: string; enqueued: boolean }>(
            `policies/${submissionId}/submission-memory/refresh`,
            { method: 'POST' },
        );
    },

    async askSubmissionMemory(submissionId: string, question: string) {
        return http.request<{
            answer: string;
            citations: SubmissionMemoryCitation[];
            mode: 'llm' | 'extractive' | 'no_evidence';
            channelsUsed: string[];
            passageCount: number;
        }>(`policies/${submissionId}/submission-memory/ask`, {
            method: 'POST',
            body: JSON.stringify({ question }),
        });
    },
};
