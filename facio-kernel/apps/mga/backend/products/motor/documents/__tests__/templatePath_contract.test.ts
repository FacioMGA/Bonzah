/**
 * templatePath_contract.test.ts
 *
 * CHAMPS Contract Test — Template Path Integrity
 *
 * Validates that every required HTML template can be resolved through the
 * SAME path strategy used by product-owned pdfRenderer.ts at production runtime:
 *
 *   const moduleDir = path.dirname(fileURLToPath(import.meta.url));
 *   const templatesRoot = path.join(moduleDir, 'templates');
 *
 * This test MUST be kept aligned with:
 *   - backend/products/motor/documents/pdfRenderer.ts           (loadTemplate)
 *   - backend/platform/config/startupValidation.ts              (REQUIRED_HTML_TEMPLATES)
 *   - infrastructure/docker/Dockerfile.api                      (COPY …/templates)
 *   - infrastructure/docker/Dockerfile.worker                   (COPY …/templates)
 *
 * WHY THIS EXISTS:
 *   On 2026-03-29 a live ENOENT error blocked all policy issuance. The file
 *   existed in the source tree but the smoke test used a different path
 *   (process.cwd() + '../templates') so the breakage was invisible in CI.
 *   This test uses loadTemplate() directly — exactly as production does —
 *   so any Dockerfile COPY target change or template deletion will fail CI
 *   before the image is pushed.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplate } from '../pdfRenderer.js';

// ── Production path constants (mirror pdfRenderer.ts) ───────────────────────

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The templates root as pdfRenderer.ts resolves it at runtime.
 * In source:  .../products/motor/documents/__tests__/ → up one → documents/templates/
 * In dist:    same relative layout after tsc build.
 */
const PRODUCTION_TEMPLATES_ROOT = path.resolve(moduleDir, '../templates');

const REQUIRED_TEMPLATES = [
  'schedule.html',
  'certificate.html',
  'green-card.html',
  'endorsements.html',
  'statement-of-fact.html',
  'invoice.html',
] as const;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Template path contract (pdfRenderer.ts production paths)', () => {
  it('templates root directory exists and is a directory', () => {
    const stat = fs.statSync(PRODUCTION_TEMPLATES_ROOT);
    expect(stat.isDirectory()).toBe(true);
  });

  for (const name of REQUIRED_TEMPLATES) {
    it(`required template '${name}' exists and is non-empty at production path`, () => {
      const absPath = path.join(PRODUCTION_TEMPLATES_ROOT, name);
      expect(fs.existsSync(absPath), `Missing: ${absPath}`).toBe(true);
      const stat = fs.statSync(absPath);
      expect(stat.size, `Empty file: ${absPath}`).toBeGreaterThan(100);
    });

    it(`loadTemplate('${name}') returns non-empty HTML string`, () => {
      const content = loadTemplate(name);
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(100);
      // All templates are HTML — a minimal sanity check.
      expect(content.toLowerCase()).toMatch(/<html|<!doctype/i);
    });
  }

  it('no required template is listed in startupValidation but absent from pdfRenderer path', () => {
    // Cross-check: startupValidation.ts checks paths relative to platform/config/
    // while pdfRenderer.ts uses its own moduleDir. Both must resolve to the same files.
    // This test ensures that all files startupValidation validates are the same
    // physical files that loadTemplate() will read.
    const startupValidationRelPaths = [
      '../../products/motor/documents/templates/certificate.html',
      '../../products/motor/documents/templates/schedule.html',
      '../../products/motor/documents/templates/endorsements.html',
      '../../products/motor/documents/templates/invoice.html',
    ];

    const platformConfigDir = path.resolve(moduleDir, '../../../../platform/config');

    for (const relPath of startupValidationRelPaths) {
      const startupResolved = path.resolve(platformConfigDir, relPath);
      const templateName = path.basename(startupResolved);
      const pdfRendererResolved = path.join(PRODUCTION_TEMPLATES_ROOT, templateName);

      // Both must exist.
      expect(fs.existsSync(startupResolved), `startupValidation path missing: ${startupResolved}`).toBe(true);
      expect(fs.existsSync(pdfRendererResolved), `pdfRenderer path missing: ${pdfRendererResolved}`).toBe(true);

      // Both must resolve to the SAME inode (same physical file, not a copy drift).
      const startupIno = fs.statSync(startupResolved).ino;
      const rendererIno = fs.statSync(pdfRendererResolved).ino;
      expect(startupIno, `Inode mismatch for ${templateName} — startupValidation and pdfRenderer resolve to different files`).toBe(rendererIno);
    }
  });
});
