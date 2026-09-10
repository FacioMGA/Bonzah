export const BONZAH_WORKSPACE_SLUG = 'bonzah-demo-fd24a745736e4e709ffc3c75438246e0';

export function buildKernelRentalEntryUrl(
  tripParameters: URLSearchParams,
  options: { baseUrl?: string; workspaceSlug?: string; source?: string } = {},
): string {
  const baseUrl = String(options.baseUrl || 'https://platform.facio.io').replace(/\/$/, '');
  const parameters = new URLSearchParams(tripParameters);
  parameters.set('workspace', options.workspaceSlug || BONZAH_WORKSPACE_SLUG);
  parameters.set('source', options.source || 'bonzah-direct');
  return `${baseUrl}/quote/rental-car/new?${parameters.toString()}`;
}
