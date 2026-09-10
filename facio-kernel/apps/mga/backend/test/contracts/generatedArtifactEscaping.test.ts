import { describe, expect, it } from 'vitest';
import {
  encodeTypeScriptStringLiteral,
  escapeMarkdownTableCell,
} from '../../../tools/quality/generatedArtifactEscaping.js';

describe('generated artifact escaping', () => {
  it('serializes untrusted text as one valid TypeScript string literal', () => {
    const source = "line one\\line two 'quoted'\nnext";
    const literal = encodeTypeScriptStringLiteral(source);

    expect(literal).toBe(JSON.stringify(source));
    expect(JSON.parse(literal)).toBe(source);
  });

  it('keeps untrusted text in one Markdown table cell', () => {
    expect(escapeMarkdownTableCell('a|b\\c\n<unsafe>&')).toBe('a\\|b\\\\c<br>&lt;unsafe&gt;&amp;');
  });
});
