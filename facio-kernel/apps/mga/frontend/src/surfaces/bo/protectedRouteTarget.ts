interface BoLocationTarget {
  pathname: string;
  search: string;
  hash: string;
}

/** Preserve an anonymous staff user's BO destination through authentication. */
export function buildBoLoginTarget(location: BoLocationTarget): string {
  const next = `${location.pathname}${location.search}${location.hash}`;
  return `/login?next=${encodeURIComponent(next)}`;
}
