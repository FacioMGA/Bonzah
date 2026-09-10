import { describe, expect, it } from 'vitest';
import { isStorageTemplatePath, readTemplateUploadMode } from '../templateUploadMode.js';

describe('templateUploadMode', () => {
  it('defaults to storage mode', () => {
    delete process.env.TEMPLATE_UPLOAD_MODE;
    expect(readTemplateUploadMode()).toBe('storage');
  });

  it('accepts disk mode explicitly', () => {
    process.env.TEMPLATE_UPLOAD_MODE = 'disk';
    expect(readTemplateUploadMode()).toBe('disk');
  });

  it('detects storage URIs', () => {
    expect(isStorageTemplatePath('/api/documents/file-1')).toBe(true);
    expect(isStorageTemplatePath('https://cdn.example.com/template.docx')).toBe(true);
    expect(isStorageTemplatePath('templates/quotes/legacy.docx')).toBe(false);
  });
});

