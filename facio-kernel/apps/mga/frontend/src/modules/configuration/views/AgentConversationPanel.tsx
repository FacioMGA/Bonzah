import React, { useState } from 'react';
import { Button } from '@/src/shared/ui';
import { configurationApi, type TemplateSummary } from '@/src/modules/configuration/api/configurationApi';
import { streamToolCalls } from '@/src/modules/configuration/api/mcpSseClient';
import { buildClassicCarDemoToolCalls } from '@/src/modules/configuration/views/demoScenarios';

interface ConversationEntry {
    id: string;
    kind: 'system' | 'tool_call' | 'tool_result' | 'tool_error';
    label: string;
    body?: string;
}

interface Props {
    onDraftCreated: (draftId: string) => void;
    selectedDraftId: string | null;
    onRefreshSummary: () => void;
}

/**
 * Phase 0 conversation panel — directly drives the two write tools
 * available today (listTemplates + cloneTemplate). Phase 1 hooks up
 * free-text natural-language prompts and SSE streaming of multi-tool
 * agent turns.
 */
export const AgentConversationPanel: React.FC<Props> = ({
    onDraftCreated,
    selectedDraftId,
    onRefreshSummary,
}) => {
    const [templates, setTemplates] = useState<TemplateSummary[]>([]);
    const [entries, setEntries] = useState<ConversationEntry[]>([
        {
            id: 'welcome',
            kind: 'system',
            label: 'Welcome to the Product Architect',
            body: 'Load templates and clone one to start a new draft. In Phase 1 this becomes a free-text agent.',
        },
    ]);
    const [productName, setProductName] = useState('Classic Car v0.1');
    const [selectedTemplateId, setSelectedTemplateId] = useState('classic-car');
    const [busy, setBusy] = useState(false);

    function append(entry: ConversationEntry) {
        setEntries((prev) => [...prev, entry]);
    }

    async function loadTemplates() {
        setBusy(true);
        append({ id: `t-${Date.now()}`, kind: 'tool_call', label: 'config.products.listTemplates' });
        try {
            const list = await configurationApi.listTemplates();
            setTemplates(list);
            append({
                id: `r-${Date.now()}`,
                kind: 'tool_result',
                label: `Loaded ${list.length} template(s)`,
                body: list.map((t: TemplateSummary) => `• ${t.templateId} — ${t.name}`).join('\n'),
            });
        } catch (err) {
            append({ id: `e-${Date.now()}`, kind: 'tool_error', label: String(err) });
        } finally {
            setBusy(false);
        }
    }

    async function clone() {
        if (!selectedTemplateId || !productName.trim()) return;
        setBusy(true);
        append({
            id: `t-${Date.now()}`,
            kind: 'tool_call',
            label: `config.products.cloneTemplate`,
            body: `templateId=${selectedTemplateId} productName="${productName}"`,
        });
        try {
            const result = await configurationApi.cloneTemplate(selectedTemplateId, productName.trim());
            append({
                id: `r-${Date.now()}`,
                kind: 'tool_result',
                label: result.summary,
                body: `Next steps:\n${result.nextRecommendedSteps.map((s: string) => `• ${s}`).join('\n')}`,
            });
            onDraftCreated(result.draftId);
        } catch (err) {
            append({ id: `e-${Date.now()}`, kind: 'tool_error', label: String(err) });
        } finally {
            setBusy(false);
        }
    }

    async function refresh() {
        if (!selectedDraftId) return;
        setBusy(true);
        append({
            id: `t-${Date.now()}`,
            kind: 'tool_call',
            label: 'config.products.getDraftSummary',
            body: `draftId=${selectedDraftId}`,
        });
        try {
            onRefreshSummary();
            append({
                id: `r-${Date.now()}`,
                kind: 'tool_result',
                label: 'Draft summary refreshed.',
            });
        } finally {
            setBusy(false);
        }
    }

    async function runDemoPrompt() {
        if (!selectedDraftId) return;
        setBusy(true);
        const toolCalls = buildClassicCarDemoToolCalls(selectedDraftId);
        append({
            id: `prompt-${Date.now()}`,
            kind: 'system',
            label: 'Manager prompt',
            body:
                'Create a Classic Car variant of motor. Refer drivers under 25, decline classic cars valued over €100k, ' +
                'refer if 2+ claims. Only allow occasional / weekend use. Require certificate and schedule on bind, green card on request. ' +
                'Payment before bind. Commission 12.5%. Pro-rata cancellation, admin fee non-refundable.',
        });
        try {
            await streamToolCalls(toolCalls, {
                sessionId: `demo-${Date.now()}`,
                onEvent: (e) => {
                    if (e.kind === 'tool_call') {
                        const data = e.data as { toolName?: string } | null;
                        append({
                            id: `t-${Date.now()}-${Math.random()}`,
                            kind: 'tool_call',
                            label: data?.toolName ?? 'tool_call',
                        });
                    } else if (e.kind === 'tool_result') {
                        const data = e.data as { toolName?: string; result?: { summary?: string } } | null;
                        append({
                            id: `r-${Date.now()}-${Math.random()}`,
                            kind: 'tool_result',
                            label: data?.result?.summary ?? `${data?.toolName ?? 'tool'} ok`,
                        });
                    } else if (e.kind === 'tool_error') {
                        const data = e.data as { toolName?: string; error?: { code?: string; message?: string } } | null;
                        append({
                            id: `e-${Date.now()}-${Math.random()}`,
                            kind: 'tool_error',
                            label: `${data?.toolName ?? 'tool'}: ${data?.error?.code ?? 'ERROR'}`,
                            body: data?.error?.message,
                        });
                    }
                },
            });
            onRefreshSummary();
        } catch (err) {
            append({ id: `e-${Date.now()}`, kind: 'tool_error', label: String(err) });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {entries.map((e) => (
                    <ConversationRow key={e.id} entry={e} />
                ))}
            </div>
            <div className="border-t border-slate-200 p-4 space-y-3 bg-slate-50">
                <div>
                    <Button onClick={loadTemplates} disabled={busy} className="text-xs">
                        Load templates
                    </Button>
                </div>
                {templates.length > 0 && (
                    <div className="space-y-2">
                        <select
                            value={selectedTemplateId}
                            onChange={(e) => setSelectedTemplateId(e.target.value)}
                            className="w-full text-sm border border-slate-300 rounded px-2 py-1"
                        >
                            {templates.map((t) => (
                                <option key={t.templateId} value={t.templateId}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                        <input
                            type="text"
                            value={productName}
                            onChange={(e) => setProductName(e.target.value)}
                            placeholder="New product name"
                            className="w-full text-sm border border-slate-300 rounded px-2 py-1"
                        />
                        <Button onClick={clone} disabled={busy} className="text-xs w-full">
                            Clone template into draft
                        </Button>
                    </div>
                )}
                {selectedDraftId && (
                    <div className="space-y-2">
                        <Button onClick={refresh} disabled={busy} className="text-xs w-full">
                            Refresh draft summary
                        </Button>
                        <Button onClick={runDemoPrompt} disabled={busy} className="text-xs w-full">
                            Run Classic Car demo prompt
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

const ConversationRow: React.FC<{ entry: ConversationEntry }> = ({ entry }) => {
    const styles: Record<ConversationEntry['kind'], string> = {
        system: 'bg-slate-100 text-slate-700',
        tool_call: 'bg-blue-50 text-blue-800 border-l-2 border-blue-400',
        tool_result: 'bg-emerald-50 text-emerald-800 border-l-2 border-emerald-400',
        tool_error: 'bg-red-50 text-red-800 border-l-2 border-red-400',
    };
    return (
        <div className={`rounded p-3 text-xs ${styles[entry.kind]}`}>
            <div className="font-semibold uppercase tracking-wide text-[10px] mb-1">{entry.kind.replace('_', ' ')}</div>
            <div className="font-medium">{entry.label}</div>
            {entry.body && (
                <pre className="text-[11px] mt-1 whitespace-pre-wrap font-mono opacity-80">{entry.body}</pre>
            )}
        </div>
    );
};
