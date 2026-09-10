const RUNTIME_ASSET_RULES = [
  { segment: '/pricing/data/', extension: '.json' },
  { segment: '/documents/templates/', extension: '.html' },
  { segment: '/documents/static/', extension: '.pdf' },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isProductRuntimeAsset(relativePath) {
  const normalized = `/${String(relativePath || '').replaceAll('\\', '/').replace(/^\/+/, '')}`;
  const lower = normalized.toLowerCase();
  return RUNTIME_ASSET_RULES.some(
    ({ segment, extension }) => lower.includes(segment) && lower.endsWith(extension),
  );
}

export function missingDockerAssetTripwires(dockerfile, relativePaths) {
  return relativePaths.filter((relativePath) => {
    const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
    const destination = `./backend/dist/${normalized.replace(/^backend\//, '')}`;
    const tripwire = new RegExp(`\\btest\\s+-f\\s+["']?${escapeRegExp(destination)}["']?`);
    return !tripwire.test(dockerfile);
  });
}
