import { describe, expect, it } from 'vitest';
import {
  buildEdgeMetadata,
  classifyEdge,
  isTrustedEdge,
  toCypherEdgeProps,
} from '../graphEdge.js';

describe('graphEdge', () => {
  it('classifies identifier_match and manual_review as DETERMINISTIC', () => {
    expect(classifyEdge('identifier_match')).toBe('DETERMINISTIC');
    expect(classifyEdge('manual_review')).toBe('DETERMINISTIC');
    expect(classifyEdge('regex')).toBe('PROBABILISTIC');
    expect(classifyEdge('llm_extraction')).toBe('PROBABILISTIC');
  });

  it('applies default confidence per creator and clamps overrides to 0..1', () => {
    expect(buildEdgeMetadata({ createdBy: 'identifier_match', sourceType: 'canonical_record', sourceId: 'c1' }).confidence).toBe(1);
    expect(buildEdgeMetadata({ createdBy: 'llm_extraction', sourceType: 'email_message', sourceId: 'm1' }).confidence).toBe(0.6);
    expect(buildEdgeMetadata({ createdBy: 'regex', sourceType: 'email_message', sourceId: 'm1', confidence: 5 }).confidence).toBe(1);
    expect(buildEdgeMetadata({ createdBy: 'regex', sourceType: 'email_message', sourceId: 'm1', confidence: -2 }).confidence).toBe(0);
  });

  it('treats only deterministic + above-floor edges as trusted', () => {
    expect(isTrustedEdge({ edgeClass: 'DETERMINISTIC', confidence: 1 })).toBe(true);
    expect(isTrustedEdge({ edgeClass: 'DETERMINISTIC', confidence: 0.4 })).toBe(false);
    // A high-confidence probabilistic edge is NOT trusted until validated.
    expect(isTrustedEdge({ edgeClass: 'PROBABILISTIC', confidence: 0.99 })).toBe(false);
  });

  it('honours an explicit edgeClass override (human-validated LLM edge)', () => {
    const meta = buildEdgeMetadata({ createdBy: 'llm_extraction', sourceType: 'email_message', sourceId: 'm1', edgeClass: 'DETERMINISTIC', confidence: 0.9 });
    expect(isTrustedEdge(meta)).toBe(true);
  });

  it('flattens to primitive cypher props and omits empty sourceSpan', () => {
    const props = toCypherEdgeProps(buildEdgeMetadata({ createdBy: 'identifier_match', sourceType: 'canonical_record', sourceId: 'c1', createdAt: '2026-01-01T00:00:00.000Z' }));
    expect(props).toMatchObject({ edgeClass: 'DETERMINISTIC', confidence: 1, sourceType: 'canonical_record', sourceId: 'c1', createdBy: 'identifier_match', createdAt: '2026-01-01T00:00:00.000Z' });
    expect('sourceSpan' in props).toBe(false);
    const withSpan = toCypherEdgeProps(buildEdgeMetadata({ createdBy: 'regex', sourceType: 'email_message', sourceId: 'm1', sourceSpan: 'EUR 30,000' }));
    expect(withSpan.sourceSpan).toBe('EUR 30,000');
  });
});
