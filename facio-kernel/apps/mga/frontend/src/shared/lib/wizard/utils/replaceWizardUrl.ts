/**
 * Guarded history.replaceState for public quote wizards.
 *
 * Browsers rate-limit replaceState (SecurityError after ~100 calls / 10s).
 * Wizard step sync effects can re-run while the URL is already correct, so
 * every call site must no-op when pathname + search + hash are unchanged.
 */

function formatHistoryHref(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function replaceWizardUrlIfChanged(
  mutate: (url: URL) => void,
  options?: { state?: unknown },
): boolean {
  if (typeof window === 'undefined') return false;

  const current = new URL(window.location.href);
  const next = new URL(current.href);
  mutate(next);

  const currentHref = formatHistoryHref(current);
  const nextHref = formatHistoryHref(next);
  if (nextHref === currentHref) return false;

  window.history.replaceState(options?.state ?? null, '', nextHref);
  return true;
}

export function replaceWizardStepInUrl(
  stepId: string,
  options?: { deleteParams?: string[]; state?: unknown },
): boolean {
  return replaceWizardUrlIfChanged(
    (url) => {
      url.searchParams.set('step', stepId);
      for (const key of options?.deleteParams ?? []) {
        url.searchParams.delete(key);
      }
    },
    { state: options?.state },
  );
}

export function stripWizardUrlSearchParams(
  paramNames: readonly string[],
  options?: { state?: unknown },
): boolean {
  return replaceWizardUrlIfChanged(
    (url) => {
      for (const key of paramNames) {
        url.searchParams.delete(key);
      }
    },
    { state: options?.state },
  );
}
