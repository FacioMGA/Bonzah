import React, { useEffect, useState } from 'react';
import { http } from '@/src/shared/api/http';
import { Button } from '@/src/shared/ui';

/** UI discovery from the same authorized active programme list used by BO. */
export function useRegisteredProducts() {
  const [products, setProducts] = useState<string[] | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setProducts(null);
    setError('');
    void http
      .request<Array<{ productType: string; status: string }>>('programs')
      .then((result) => {
        if (!result.success || !Array.isArray(result.data))
          throw new Error(
            result.error?.message || 'Registered insurance programmes are unavailable.',
          );
        if (active)
          setProducts([
            ...new Set(
              result.data
                .filter((program) => program.status.toUpperCase() === 'ACTIVE')
                .map((program) => program.productType.toUpperCase()),
            ),
          ]);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Registered insurance programmes are unavailable.',
          );
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return { products, error, retry: () => setAttempt((value) => value + 1) };
}
export function RegisteredProductGate({
  productType,
  children,
}: {
  productType: string;
  children: React.ReactNode;
}) {
  const { products, error, retry } = useRegisteredProducts();
  if (products?.includes(productType.toUpperCase())) return <>{children}</>;
  return (
    <main className="min-h-screen grid place-items-center bg-brand-canvas p-6">
      <section className="ui-card ui-card-pad max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">Insurance programme availability</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button type="button" onClick={retry}>
              Retry programme lookup
            </Button>
          </>
        ) : products ? (
          <p>This product has no active programme in the selected workspace.</p>
        ) : (
          <p role="status">Checking registered insurance programmes…</p>
        )}
        <a href="/quote/start" className="block underline">
          Choose an available product
        </a>
        <a href="/workspaces" className="block underline">
          Select a workspace
        </a>
      </section>
    </main>
  );
}
