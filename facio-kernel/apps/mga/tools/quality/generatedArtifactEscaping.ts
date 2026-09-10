/** Safe literal encoding for generated TypeScript source. */
export function encodeTypeScriptStringLiteral(value: string): string {
  return JSON.stringify(value);
}

/** Keep generated Markdown values within a single, non-HTML table cell. */
export function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}
