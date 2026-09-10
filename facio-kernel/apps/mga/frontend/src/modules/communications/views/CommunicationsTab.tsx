import { Button } from '@/src/shared/ui';
import { communicationsApiClient } from '../api/communicationsApiClient';
import { useCommunicationsController } from '../hooks/useCommunicationsController';
import { Timeline } from './Timeline';
import { ComposerArea } from './ComposerArea';
import { policyCrudApiClient } from '@/src/modules/policies/api/policyCrudApiClient';
import { useEffect, useState } from 'react';

interface CommunicationsTabProps {
    entityType: string;
    entityId: string;
    primaryPartyId?: string;
    templateDefaults?: Record<string, string>;
}

export function CommunicationsTab({ entityType, entityId, primaryPartyId, templateDefaults }: CommunicationsTabProps) {
    const {
        timeline,
        users,
        recipients,
        loading,
        error,
        refresh,
    } = useCommunicationsController({ entityType, entityId });
    const [derivedTemplateDefaults, setDerivedTemplateDefaults] = useState<Record<string, string>>({});

    useEffect(() => {
        let active = true;
        if (entityType !== 'POLICY' || !entityId) {
            setDerivedTemplateDefaults({});
            return () => { active = false; };
        }
        void policyCrudApiClient.getPublicSessionToken(entityId).then((result) => {
            if (!active || !result?.success) return;
            const token = String(result.data?.publicSessionToken || '').trim();
            if (!token) return;
            const product = String(result.data?.productType || '').trim().toLowerCase();
            const base = window.location.origin.replace(/\/$/, '');
            const productQuery = product ? `&product=${encodeURIComponent(product)}` : '';
            const quoteUrl = `${base}/quote/${encodeURIComponent(token)}?step=policy-holder${productQuery}`;
            const dashboardUrl = `${base}/login?mode=signup&claimToken=${encodeURIComponent(token)}&next=%2Fclient`;
            setDerivedTemplateDefaults({
                'quote.url': quoteUrl,
                'renewal.url': quoteUrl,
                'uw.url': quoteUrl,
                'policy.dashboardUrl': dashboardUrl,
            });
        }).catch(() => {
            if (active) setDerivedTemplateDefaults({});
        });
        return () => { active = false; };
    }, [entityId, entityType]);

    const mergedTemplateDefaults = {
        ...(templateDefaults || {}),
        ...derivedTemplateDefaults,
    };

    const handleRetry = async (messageId: string) => {
        const result = await communicationsApiClient.retryMessage(messageId);
        if (result.success) {
            await refresh();
        }
    };

    const handleApprove = async (messageId: string) => {
        const result = await communicationsApiClient.approveMessage(messageId);
        if (result.success) {
            await refresh();
        }
    };

    const handleReject = async (messageId: string) => {
        const result = await communicationsApiClient.rejectMessage(messageId);
        if (result.success) {
            await refresh();
        }
    };

    return (
        <div className="grid h-[min(72vh,820px)] min-h-[560px] grid-rows-[1fr_auto] overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] shadow-sm">
            <div className="relative min-h-0 bg-slate-50/60">
                {loading ? (
                    <div className="flex h-full min-h-[420px] items-center justify-center text-sm font-medium text-slate-400">
                        Loading communications…
                    </div>
                ) : error ? (
                    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center">
                        <div className="text-base font-bold text-slate-900">Unable to load communications</div>
                        <div className="max-w-lg text-sm text-slate-500">{error}</div>
                        <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()}>
                            Retry
                        </Button>
                    </div>
                ) : (
                    <div className="flex h-full min-h-0 flex-col">
                        {entityType === 'POLICY' && (
                            <div className="border-b border-slate-100 bg-white px-5 py-3 text-xs font-semibold text-slate-500">
                                Document packs already sent to the customer appear as <span className="font-black text-slate-700">Documents sent</span> on the emails below.
                            </div>
                        )}
                        <div className="min-h-0 flex-1">
                            <Timeline
                                items={timeline}
                                users={users}
                                onRetry={(messageId) => { void handleRetry(messageId); }}
                                onApprove={(messageId) => { void handleApprove(messageId); }}
                                onReject={(messageId) => { void handleReject(messageId); }}
                            />
                        </div>
                    </div>
                )}
            </div>
            <div className="sticky bottom-0 z-10 flex-shrink-0 bg-transparent">
                <ComposerArea
                    entityType={entityType}
                    entityId={entityId}
                    primaryPartyId={primaryPartyId}
                    recipients={recipients}
                    templateDefaults={mergedTemplateDefaults}
                    onMessageSent={refresh}
                />
            </div>
        </div>
    );
}
