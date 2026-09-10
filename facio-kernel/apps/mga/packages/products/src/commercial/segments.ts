export type CommercialSegmentSource = {
  details?: {
    professions?: readonly { segmentId?: string; profession?: string }[];
    productLines?: readonly { status?: string; triggerSegmentId?: string }[];
  };
};

/** Symphony's configured segment union. Draft product lines cannot advertise an executable route. */
export function configuredCommercialSegments(product: CommercialSegmentSource): { id: string; name: string }[] {
  const values = new Map<string, { id: string; name: string }>();
  for (const row of product.details?.professions ?? []) {
    const id = (row.segmentId || row.profession || '').trim();
    if (id && !values.has(id)) values.set(id, { id, name: (row.profession || id).trim() || id });
  }
  for (const row of product.details?.productLines ?? []) {
    const id = (row.triggerSegmentId || '').trim();
    if (row.status === 'Ready' && id && !values.has(id)) values.set(id, { id, name: id });
  }
  return [...values.values()];
}
