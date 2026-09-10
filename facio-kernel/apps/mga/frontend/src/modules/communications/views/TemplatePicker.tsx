import { useEffect, useState } from 'react';
import { Button, Card, CardContent } from '@/src/shared/ui';
import { communicationsApiClient } from '../api/communicationsApiClient';
import type { CommunicationTemplate } from '../model/types';

interface TemplatePickerProps {
    channel: string;
    selectedTemplateId?: string;
    open?: boolean;
    onToggle: () => void;
    onSelect: (template: CommunicationTemplate) => void;
    inline?: boolean;
    showTrigger?: boolean;
}

export function TemplatePicker({
    channel,
    selectedTemplateId,
    open = false,
    onToggle,
    onSelect,
    inline = false,
    showTrigger = true,
}: TemplatePickerProps) {
    const [templates, setTemplates] = useState<CommunicationTemplate[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const res = await communicationsApiClient.listTemplates({ channel });
                const payload = res && typeof res === 'object' && 'data' in res
                    ? (res as { data?: CommunicationTemplate[] }).data || []
                    : [];
                if (!cancelled) setTemplates(payload);
            } catch {
                if (!cancelled) setTemplates([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [channel]);

    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

    return (
        <div className="relative">
            {showTrigger && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={inline
                        ? `whitespace-nowrap rounded-none border-0 bg-transparent px-0 py-0 text-xs font-semibold uppercase tracking-[0.12em] shadow-none ${selectedTemplate ? 'text-brand-primary' : 'text-slate-400 hover:text-slate-700'}`
                        : `whitespace-nowrap rounded-2xl border ${selectedTemplate ? 'border-brand-primary/30 text-brand-primary' : 'border-slate-200/80 text-slate-600'} bg-transparent shadow-sm backdrop-blur`}
                    onClick={onToggle}
                >
                    {selectedTemplate ? selectedTemplate.name : '/template'}
                </Button>
            )}
            {open && (
                <Card
                    variant="elevated"
                    padding="sm"
                    className={`absolute right-0 z-20 w-80 border border-slate-200 shadow-xl ${inline ? 'bottom-full mb-2' : 'top-11'}`}
                >
                    <CardContent className="space-y-2">
                        <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                            Email templates
                        </div>
                        {loading && (
                            <div className="text-sm text-slate-500">Loading templates…</div>
                        )}
                        {!loading && !templates.length && (
                            <div className="text-sm text-slate-500">No templates available for this channel.</div>
                        )}
                        {!loading && templates.map((template) => (
                            <button
                                key={template.id}
                                type="button"
                                disabled={Boolean(template.systemOnly)}
                                onClick={() => onSelect(template)}
                                className={`flex w-full flex-col rounded-2xl border border-slate-100 px-4 py-3 text-left transition ${
                                    template.systemOnly
                                        ? 'cursor-not-allowed opacity-55'
                                        : 'hover:border-brand-primary/30 hover:bg-slate-50'
                                }`}
                            >
                                <span className="font-bold text-slate-900">{template.name}</span>
                                <span className="mt-1 text-xs text-slate-500">
                                    {template.systemOnly
                                        ? 'System-only template'
                                        : (template.approvalRequired ? 'Approval required' : 'Ready to send')}
                                </span>
                            </button>
                        ))}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
