import React, { useEffect, useState } from 'react';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import type { Currency, Program } from '@/src/modules/programs/model/programs';

interface CreateProgramModalProps {
    onClose: () => void;
    onCreated: (program: Program) => void;
}

export const CreateProgramModal: React.FC<CreateProgramModalProps> = ({ onClose, onCreated }) => {
    const [name, setName] = useState('');
    const [productType, setProductType] = useState('');
    const [products, setProducts] = useState<Array<{ code: string; displayName: string }>>([]);
    const [productsLoading, setProductsLoading] = useState(true);
    const [currency, setCurrency] = useState<Currency>('EUR');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const loadProducts = async () => {
            try {
                setProductsLoading(true);
                const response = await api.request('products');
                if (!response?.success) throw new Error(response?.error?.message || 'Failed to load product definitions');
                if (!cancelled) setProducts(Array.isArray(response.data) ? response.data as Array<{ code: string; displayName: string }> : []);
            } catch (loadError: unknown) {
                if (!cancelled) {
                    setError(loadError instanceof Error ? loadError.message : 'Failed to load product definitions');
                }
            } finally {
                if (!cancelled) setProductsLoading(false);
            }
        };
        void loadProducts();
        return () => { cancelled = true; };
    }, []);

    const handleCreate = async () => {
        if (!name.trim()) return;
        try {
            setLoading(true);
            setError(null);

            const payload = {
                name,
                productType,
                currency,
                status: 'DRAFT',
                metadata: {
                    currency,
                    pricingModel: 'Hybrid', // Default
                    cadence: 'Monthly', // Default
                    validation: { exceptionQueue: 'Auto-create exceptions' },
                    endorsements: { requireReason: true, requireEffectiveDate: true },
                },
            };

            const resp = await api.createProgram(payload);
            if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to create program');

            onCreated(resp.data as Program);
            onClose();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to create program');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                    <div className="text-lg font-black text-slate-900">Create new program</div>
                    <div className="mt-1 text-sm text-slate-500 font-medium">Start a new scheme configuration</div>
                </div>

                <div className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-100 text-xs font-bold text-rose-700">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Program name</label>
                        <Input
                            className="ui-input w-full"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Motor 2026"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label htmlFor="create-program-product" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Product</label>
                        <Select
                            id="create-program-product"
                            className="ui-select w-full"
                            value={productType}
                            onChange={(e) => setProductType(e.target.value)}
                            disabled={productsLoading || products.length === 0}
                        >
                            <option value="">{productsLoading ? 'Loading products…' : 'Choose a product'}</option>
                            {products.map((product) => (
                                <option key={product.code} value={product.code}>{product.displayName} ({product.code})</option>
                            ))}
                        </Select>
                    </div>

                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Currency</label>
                        <Select
                            className="ui-select w-full"
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value as Currency)}
                        >
                            <option value="EUR">EUR (€)</option>
                            <option value="GBP">GBP (£)</option>
                            <option value="USD">USD ($)</option>
                        </Select>
                    </div>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
                    <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
                    <Button onClick={handleCreate} disabled={loading || !name.trim() || !productType}>{loading ? 'Creating...' : 'Create Program'}</Button>
                </div>
            </div>
        </div>
    );
};
