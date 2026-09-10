function stableTuple(version) {
  const match = String(version || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

export function highestStableVersion(versions) {
  let best = null;
  let bestTuple = null;
  for (const version of Array.isArray(versions) ? versions : []) {
    const tuple = stableTuple(version);
    if (!tuple) continue;
    if (!bestTuple || tuple.some((part, index) => part !== bestTuple[index]
      && tuple.slice(0, index).every((prefixPart, prefixIndex) => prefixPart === bestTuple[prefixIndex])
      && part > bestTuple[index])) {
      best = String(version).replace(/^v/, '');
      bestTuple = tuple;
    }
  }
  return best;
}
