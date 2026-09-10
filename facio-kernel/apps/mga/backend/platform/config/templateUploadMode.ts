export type TemplateUploadMode = 'disk' | 'storage';

export function readTemplateUploadMode(): TemplateUploadMode {
  const raw = String(process.env.TEMPLATE_UPLOAD_MODE || 'storage').trim().toLowerCase();
  return raw === 'disk' ? 'disk' : 'storage';
}

export function isStorageTemplatePath(candidate: unknown): boolean {
  const value = String(candidate || '').trim();
  return value.startsWith('/api/documents/') || /^https?:\/\//i.test(value);
}

