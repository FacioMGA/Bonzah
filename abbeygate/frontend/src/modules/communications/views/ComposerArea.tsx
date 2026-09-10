import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Textarea } from '@/src/shared/ui';
import { communicationsApiClient } from '../api/communicationsApiClient';
import { recipientsForChannel } from '../model/recipientsForChannel';
import { TemplatePicker } from './TemplatePicker';
import type {
    CommunicationAttachment,
    CommunicationChannel,
    CommunicationTemplate,
    ResolvedRecipient,
    TemplateRenderPreview,
    TemplateVariableDescriptor,
} from '../model/types';

interface ComposerAreaProps {
    entityType: string;
    entityId: string;
    primaryPartyId?: string;
    recipients: ResolvedRecipient[];
    templateDefaults?: Record<string, string>;
    onMessageSent?: () => void;
}

const CHANNEL_OPTIONS: Array<{
    value: CommunicationChannel;
    label: string;
    disabled?: boolean;
    description?: string;
}> = [
    { value: 'EMAIL', label: 'Email' },
    { value: 'PHONE_CALL', label: 'Log call' },
    { value: 'NOTE', label: 'Internal Note' },
    { value: 'SMS', label: 'SMS' },
    { value: 'WHATSAPP', label: 'WhatsApp' },
];

function ChannelIcon(props: { channel: CommunicationChannel; className?: string }) {
    const { channel, className = 'h-4 w-4' } = props;
    if (channel === 'EMAIL') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3.5" y="5.5" width="17" height="13" rx="3" strokeWidth="1.7" />
                <path d="M5.5 8l6.5 5 6.5-5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (channel === 'NOTE') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M8 4.5h8l3 3v12a2 2 0 0 1-2 2H8a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3Z" strokeWidth="1.7" />
                <path d="M9 10h6M9 14h6M9 18h4" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
        );
    }
    if (channel === 'SMS') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 6.5h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H11l-4.5 3v-3H6a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
        );
    }
    if (channel === 'PHONE_CALL') {
        return (
            <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6.5 4.5 9.7 3.4l2.2 4.7-1.8 1.2c.9 1.9 2.4 3.4 4.4 4.4l1.2-1.8 4.7 2.2-1.1 3.2c-.3.9-1.2 1.4-2.1 1.2C10.8 17.4 6.6 13.2 5.3 6.8c-.2-.9.3-1.8 1.2-2.3Z" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M7.5 4.5h9a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-4 3v-3h0a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Z" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M9 9.5h6M9 13h4" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    );
}

function currentUserRole(): string {
    try {
        const raw = localStorage.getItem('user_info');
        if (!raw) return '';
        const parsed = JSON.parse(raw) as { role?: unknown };
        return String(parsed.role || '').toUpperCase();
    } catch {
        return '';
    }
}

function fileTypeLabel(attachment: CommunicationAttachment): string {
    const ext = String(attachment.filename || '').split('.').pop()?.toUpperCase();
    if (ext) return ext;
    const mime = String(attachment.mimetype || '').toLowerCase();
    if (mime.includes('pdf')) return 'PDF';
    if (mime.includes('image')) return 'IMAGE';
    if (mime.includes('sheet') || mime.includes('excel')) return 'XLSX';
    if (mime.includes('word') || mime.includes('doc')) return 'DOCX';
    return 'FILE';
}

export function ComposerArea({
    entityType,
    entityId,
    primaryPartyId,
    recipients,
    templateDefaults = {},
    onMessageSent,
}: ComposerAreaProps) {
    const [channel, setChannel] = useState<CommunicationChannel>('EMAIL');
    const [selectedRecipientId, setSelectedRecipientId] = useState('');
    const [body, setBody] = useState('');
    const [subject, setSubject] = useState('');
    const [sending, setSending] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [showTemplates, setShowTemplates] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<CommunicationTemplate | null>(null);
    const [_templateDescriptor, setTemplateDescriptor] = useState<TemplateVariableDescriptor | null>(null);
    const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
    const [templatePreview, setTemplatePreview] = useState<TemplateRenderPreview | null>(null);
    const [_templateLoading, setTemplateLoading] = useState(false);
    const [attachments, setAttachments] = useState<CommunicationAttachment[]>([]);
    const [attachmentsUploading, setAttachmentsUploading] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [subjectFocused, setSubjectFocused] = useState(false);
    const [composerHasFocus, setComposerHasFocus] = useState(false);
    const [channelMenuOpen, setChannelMenuOpen] = useState(false);
    const [recipientMenuOpen, setRecipientMenuOpen] = useState(false);
    const [recipientSearch, setRecipientSearch] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const composerRef = useRef<HTMLDivElement | null>(null);
    const channelMenuRef = useRef<HTMLDivElement | null>(null);
    const recipientMenuRef = useRef<HTMLDivElement | null>(null);
    const templateMenuRef = useRef<HTMLDivElement | null>(null);

    const isInternalNote = channel === 'NOTE';
    const role = currentUserRole();
    const isInternalUser = role === 'ADMIN' || role === 'UNDERWRITER';
    const requiresSubject = channel === 'EMAIL' && !isInternalNote;
    const approvalRequired = Boolean(selectedTemplate?.approvalRequired && !isInternalUser);

    const composerExpanded =
        composerHasFocus ||
        isFocused ||
        subjectFocused ||
        Boolean(body.trim() || subject.trim() || selectedTemplate || attachments.length);

    // Filter recipients by selected channel. Internal notes go to staff
    // (recipientClass INTERNAL), not the customer email list (ABY-448).
    const availableRecipients = useMemo(
        () => recipientsForChannel(recipients, channel),
        [recipients, channel],
    );

    const groupedRecipients = useMemo(() => {
        return availableRecipients.reduce<Record<string, ResolvedRecipient[]>>((acc, recipient) => {
            const key = recipient.groupLabel || 'Recipients';
            acc[key] = acc[key] || [];
            acc[key].push(recipient);
            return acc;
        }, {});
    }, [availableRecipients]);

    const selectedRecipient = availableRecipients.find((recipient) => recipient.participantId === selectedRecipientId) || null;



    const filteredGroupedRecipients = useMemo(() => {
        const query = recipientSearch.trim().toLowerCase();
        const nextGroups: Array<{ groupLabel: string; items: ResolvedRecipient[] }> = [];
        Object.entries(groupedRecipients).forEach(([groupLabel, items]) => {
            const filteredItems = query
                ? items.filter((item) => {
                    const haystack = `${item.contactName} ${item.role} ${item.address}`.toLowerCase();
                    return haystack.includes(query);
                })
                : items;
            if (filteredItems.length) {
                nextGroups.push({ groupLabel, items: filteredItems });
            }
        });
        return nextGroups;
    }, [groupedRecipients, recipientSearch]);

    useEffect(() => {
        if (selectedRecipientId && availableRecipients.some((recipient) => recipient.participantId === selectedRecipientId)) {
            return;
        }
        const primaryRecipient =
            availableRecipients.find((recipient) => recipient.isPrimary) ||
            (availableRecipients.length === 1 ? availableRecipients[0] : null);
        setSelectedRecipientId(primaryRecipient?.participantId || '');
    }, [availableRecipients, selectedRecipientId]);

    useEffect(() => {
        if (!textareaRef.current) return;
        textareaRef.current.style.height = '0px';
        textareaRef.current.style.height = `${Math.max(24, textareaRef.current.scrollHeight)}px`;
    }, [body, isFocused]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (channelMenuRef.current && !channelMenuRef.current.contains(target)) setChannelMenuOpen(false);
            if (recipientMenuRef.current && !recipientMenuRef.current.contains(target)) setRecipientMenuOpen(false);
            if (templateMenuRef.current && !templateMenuRef.current.contains(target)) setShowTemplates(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!selectedTemplate) {
            setTemplateDescriptor(null);
            setTemplateValues({});
            setTemplatePreview(null);
            return;
        }
        let active = true;
        setTemplateLoading(true);
        void communicationsApiClient.getTemplateVariables(selectedTemplate.id)
            .then((result) => {
                if (!active) return;
                const descriptor = result && typeof result === 'object' && 'data' in result
                    ? (result as { data?: TemplateVariableDescriptor }).data || null
                    : null;
                setTemplateDescriptor(descriptor);
                setTemplateValues((prev) => Object.fromEntries((descriptor?.variables || []).map((key) => [key, prev[key] || templateDefaults[key] || ''])));
            })
            .finally(() => {
                if (active) setTemplateLoading(false);
            });
        return () => { active = false; };
    }, [selectedTemplate, templateDefaults]);

    useEffect(() => {
        if (!selectedTemplate) return;
        let active = true;
        setTemplateLoading(true);
        void communicationsApiClient.renderTemplate({
            templateId: selectedTemplate.id,
            variables: templateValues,
        }).then((result) => {
            if (!active) return;
            const preview = result && typeof result === 'object' && 'data' in result
                ? (result as { data?: TemplateRenderPreview }).data || null
                : null;
            setTemplatePreview(preview);
            if (preview?.renderedSubject) {
                setSubject(preview.renderedSubject);
            }
            if (preview?.renderedBody) {
                setBody(preview.renderedBody);
            }
        }).finally(() => {
            if (active) setTemplateLoading(false);
        });
        return () => { active = false; };
    }, [selectedTemplate, templateValues]);

    const handleTemplateSelect = (template: CommunicationTemplate) => {
        setSelectedTemplate(template);
        setShowTemplates(false);
        setBody('');
        setSubject('');
    };

    const handleAttachmentSelect = async (files: File[]) => {
        try {
            setAttachmentsUploading(true);
            const result = await communicationsApiClient.uploadAttachments(files);
            if (!result.success) {
                setErrorMessage(String(result.error?.message || 'Failed to upload attachments'));
                return;
            }
            const uploaded = Array.isArray(result.data) ? result.data : [];
            setAttachments((prev) => [...prev, ...uploaded]);
        } catch {
            setErrorMessage('Failed to upload attachments');
        } finally {
            setAttachmentsUploading(false);
        }
    };

    const selectedChannelMeta = CHANNEL_OPTIONS.find((option) => option.value === channel) || CHANNEL_OPTIONS[0];

    const handleSend = async () => {
        if (!body.trim()) return;
        if (!selectedRecipientId) {
            setErrorMessage(availableRecipients.length === 0
                ? (isInternalNote
                    ? 'No staff recipients are currently available for an internal note.'
                    : `No ${channel.toLowerCase()} recipients are currently available for this policy.`)
                : 'Select a recipient before sending.');
            setRecipientMenuOpen(true);
            return;
        }
        if (templatePreview?.missingVariables?.length) {
            setErrorMessage('Fill in all required template fields before sending.');
            return;
        }

        setSending(true);
        setErrorMessage('');

        try {
            const selectedRecipient = availableRecipients.find(
                (r) => r.participantId === selectedRecipientId,
            );

            const result = await communicationsApiClient.sendMessage({
                entityType,
                entityId,
                primaryPartyId,
                direction: isInternalNote ? 'INTERNAL' : 'OUTBOUND',
                channel,
                provider: isInternalNote
                    ? 'SYSTEM'
                    : channel === 'PHONE_CALL'
                        ? 'MANUAL'
                    : channel === 'SMS'
                        ? 'TWILIO'
                        : channel === 'WHATSAPP'
                            ? 'TWILIO'
                            : 'SENDGRID',
                communicationType: isInternalNote ? 'INTERNAL_NOTE' : 'EXTERNAL',
                toRecipients: [selectedRecipient?.address || selectedRecipientId],
                subject: requiresSubject ? subject || undefined : undefined,
                body,
                attachments,
                status: isInternalNote || channel === 'PHONE_CALL' ? 'LOGGED' : 'QUEUED',
                templateId: selectedTemplate?.id,
                templateVariables: templateValues,
                renderedBody: templatePreview?.renderedBody || body,
                renderedSubject: templatePreview?.renderedSubject || subject,
                missingVariables: templatePreview?.missingVariables || [],
            });
            if (!result.success) {
                const msg = String(result.error?.message || 'Failed to send message');
                setErrorMessage(msg);
                return;
            }

            setBody('');
            setSubject('');
            setSelectedRecipientId('');
            setSelectedTemplate(null);
            setTemplateDescriptor(null);
            setTemplateValues({});
            setTemplatePreview(null);
            setAttachments([]);
            onMessageSent?.();
        } catch {
            setErrorMessage('Failed to send message');
        } finally {
            setSending(false);
        }
    };

    return (
        <div
            ref={composerRef}
            className="bg-transparent px-5 py-4"
            onFocusCapture={() => setComposerHasFocus(true)}
            onBlurCapture={() => {
                window.setTimeout(() => {
                    const active = document.activeElement;
                    if (!composerRef.current?.contains(active)) {
                        setComposerHasFocus(false);
                        setIsFocused(false);
                        setSubjectFocused(false);
                    }
                }, 0);
            }}
        >
            <div className="mx-auto flex max-w-5xl flex-col gap-3">
                <div
                    className={`rounded-[20px] bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)] transition-all ${composerExpanded ? 'px-4 py-3' : 'px-3 py-2'}`}
                >
                    <div className="flex flex-col gap-2">
                        {errorMessage && (
                            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                                {errorMessage}
                            </div>
                        )}

                        {!!attachments.length && (
                            <div className="flex flex-wrap gap-3 px-1 pb-1">
                                {attachments.map((attachment) => (
                                    <div
                                        key={`${attachment.storageUri || attachment.filename}:${attachment.filename}`}
                                        className="flex min-w-[240px] max-w-[360px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
                                    >
                                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-sm">
                                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                <path d="M8 3.5h6l4.5 4.5V19a2 2 0 0 1-2 2H8A2.5 2.5 0 0 1 5.5 18.5V6A2.5 2.5 0 0 1 8 3.5Z" strokeWidth="1.7" strokeLinejoin="round" />
                                                <path d="M14 3.5V8h4.5" strokeWidth="1.7" strokeLinejoin="round" />
                                            </svg>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-bold text-slate-900">{attachment.filename}</div>
                                            <div className="mt-0.5 text-sm text-slate-500">{fileTypeLabel(attachment)}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setAttachments((prev) => prev.filter((item) => (item.storageUri || item.filename) !== (attachment.storageUri || attachment.filename)))}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                            title="Remove attachment"
                                        >
                                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-3">
                            <div ref={channelMenuRef} className="relative">
                                <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setChannelMenuOpen((prev) => !prev)}
                                    className="inline-flex items-center gap-2 rounded-2xl px-2 py-1 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                >
                                    <ChannelIcon channel={selectedChannelMeta.value} className="h-4 w-4 text-slate-500" />
                                    <span>{selectedChannelMeta.label}</span>
                                    <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <path d="m7 10 5 5 5-5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                                {channelMenuOpen && (
                                    <div className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl">
                    {CHANNEL_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                                                type="button"
                                                disabled={opt.disabled}
                            onClick={() => {
                                                    if (opt.disabled) return;
                                setChannel(opt.value);
                                setSelectedRecipientId('');
                                                    setSelectedTemplate(null);
                                                    setChannelMenuOpen(false);
                                                }}
                                                className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                                                    opt.disabled
                                                        ? 'cursor-not-allowed opacity-45'
                                                        : channel === opt.value
                                                            ? 'bg-slate-100'
                                                            : 'hover:bg-slate-50'
                                                }`}
                                            >
                                                <span className="inline-flex items-center gap-3">
                                                    <ChannelIcon channel={opt.value} className="h-4 w-4 text-slate-500" />
                                                    <span className="text-sm font-semibold text-slate-800">{opt.label}</span>
                                                </span>
                                                {opt.description && (
                                                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                                        {opt.description}
                                                    </span>
                                                )}
                        </button>
                    ))}
                                    </div>
                                )}
                </div>

                <div ref={recipientMenuRef} className="relative min-w-[200px] flex-1">
                                    <button
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => setRecipientMenuOpen((prev) => !prev)}
                                        className="inline-flex h-9 min-w-[180px] max-w-full items-center gap-2 rounded-2xl px-2 py-1 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                    >
                                        <span className="truncate">
                                            {selectedRecipient
                                                ? selectedRecipient.contactName
                                                : (isInternalNote ? 'Select staff' : 'Select recipient')}
                                        </span>
                                        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <path d="m7 10 5 5 5-5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </button>
                                    {recipientMenuOpen && (
                                        <div className="absolute bottom-full left-0 z-30 mb-2 w-[320px] rounded-3xl border border-slate-200 bg-white p-3 shadow-2xl">
                                            <div className="mb-3">
                                                <Input
                                                    value={recipientSearch}
                                                    onChange={(e) => setRecipientSearch(e.target.value)}
                                                    placeholder="Search people"
                                                    variant="ui"
                                                    className="h-10 rounded-2xl border-0 bg-slate-50 px-4 py-2 text-sm shadow-none"
                                                />
                                            </div>
                                            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                                                {filteredGroupedRecipients.length ? filteredGroupedRecipients.map(({ groupLabel, items }) => (
                                                    <div key={groupLabel}>
                                                        <div className="px-2 pb-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                                                            {groupLabel}
                                                        </div>
                                                        <div className="space-y-1">
                                                            {items.map((recipient) => (
                                                                <button
                                                                    key={`${recipient.participantId}-${recipient.channel}`}
                                                                    type="button"
                                                                    disabled={Boolean(recipient.disabledReason)}
                                                                    onClick={() => {
                                                                        setSelectedRecipientId(recipient.participantId);
                                                                        setRecipientMenuOpen(false);
                                                                        setRecipientSearch('');
                                                                    }}
                                                                    className={`flex w-full items-start justify-between rounded-2xl px-3 py-3 text-left transition ${
                                                                        recipient.disabledReason
                                                                            ? 'cursor-not-allowed opacity-45'
                                                                            : 'hover:bg-slate-50'
                                                                    }`}
                                                                >
                                                                    <div className="min-w-0">
                                                                        <div className="truncate text-sm font-semibold text-slate-800">
                                                                            {recipient.contactName}
                                                                        </div>
                                                                        <div className="truncate text-xs text-slate-500">
                                                                            {recipient.role} · {recipient.address}
                                                                        </div>
                                                                    </div>
                                                                    {selectedRecipientId === recipient.participantId && (
                                                                        <span className="ml-3 text-xs font-bold text-brand-primary">Selected</span>
                                                                    )}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )) : (
                                                    <div className="px-2 py-6 text-center text-sm text-slate-500">
                                                        No recipients found.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
            </div>

                        {requiresSubject && (
                            <div
                                className={`overflow-hidden rounded-[18px] bg-slate-50 px-4 transition-all ${
                                    composerExpanded
                                        ? 'max-h-12 py-2 opacity-100'
                                        : 'max-h-0 py-0 opacity-0 pointer-events-none'
                                }`}
                            >
                <input
                    type="text"
                    value={subject}
                                    onFocus={() => setSubjectFocused(true)}
                                    onBlur={() => setSubjectFocused(false)}
                    onChange={(e) => setSubject(e.target.value)}
                                    placeholder="Subject"
                                    className="h-6 w-full border-0 bg-transparent px-0 py-0 text-[15px] leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus:outline-none"
                                />
                            </div>
                        )}

                        <div
                            className={`relative rounded-[18px] bg-slate-50 transition-all ${composerExpanded ? 'min-h-[72px]' : 'min-h-[44px]'}`}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                multiple
                                onChange={(e) => {
                                    const files = e.target.files ? Array.from(e.target.files) : [];
                                    if (files.length) {
                                        void handleAttachmentSelect(files);
                                    }
                                    e.currentTarget.value = '';
                                }}
                            />
                            <div className={`flex gap-2 ${composerExpanded ? 'items-start px-3 py-3' : 'items-center px-3 py-[10px]'}`}>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-white hover:shadow-sm hover:text-slate-800 ${composerExpanded ? 'mt-0.5' : ''}`}
                                    title="Add attachment"
                                >
                                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <path d="M12 5v14M5 12h14" strokeWidth="1.8" strokeLinecap="round" />
                                    </svg>
                                </button>
                                <div className="min-w-0 flex-1">
                                    <Textarea
                                        ref={textareaRef}
                                        value={body}
                                        onFocus={() => setIsFocused(true)}
                                        onBlur={() => setIsFocused(false)}
                                        onChange={(e) => {
                                            setBody(e.target.value);
                                            if (channel === 'EMAIL' && e.target.value.includes('/template')) {
                                                setShowTemplates(true);
                                            }
                                        }}
                                        placeholder={isInternalNote ? 'Write an internal note…' : channel === 'PHONE_CALL' ? 'Log call outcome…' : 'Type your message…'}
                                        className={`border-0 bg-transparent px-0 py-0 text-[15px] leading-6 shadow-none placeholder:text-slate-400 hover:bg-transparent focus:border-0 focus:bg-transparent focus:ring-0 ${composerExpanded ? 'min-h-[72px] rounded-none' : 'min-h-[24px] overflow-hidden rounded-none'}`}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSend}
                                    disabled={sending || attachmentsUploading || !body.trim()}
                                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white shadow-lg transition-all ${composerExpanded ? 'mt-0.5' : ''} ${body.trim() ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-90'}`}
                                    title={isInternalNote ? 'Save note' : channel === 'PHONE_CALL' ? 'Log call' : approvalRequired ? 'Submit for approval' : 'Send message'}
                                >
                                    {sending ? (
                                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <path d="M12 3a9 9 0 1 0 9 9" strokeWidth="1.8" strokeLinecap="round" />
                                        </svg>
                                    ) : (
                                        <span className="text-lg leading-none">↑</span>
                                    )}
                                </button>
                            </div>
                            {composerExpanded && channel === 'EMAIL' && !selectedTemplate && (
                                <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setShowTemplates(true)}
                                    className="absolute bottom-3 right-14 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 transition hover:text-slate-700"
                                >
                                    /template
                                </button>
                            )}
                            {composerExpanded && channel === 'EMAIL' && showTemplates && (
                                <div ref={templateMenuRef} className="absolute bottom-full right-0 z-30 mb-2">
                                    <TemplatePicker
                                        channel={channel}
                                        selectedTemplateId={selectedTemplate?.id}
                                        open={showTemplates}
                                        onToggle={() => setShowTemplates((prev) => !prev)}
                                        onSelect={handleTemplateSelect}
                                        inline
                                        showTrigger={false}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-400">
                        {isInternalNote
                            ? 'Internal notes stay inside the team timeline and go to the selected staff member.'
                            : channel === 'PHONE_CALL'
                                ? 'Phone calls are logged manually in the policy timeline.'
                            : approvalRequired
                                ? 'This message will be submitted for approval before delivery.'
                                : 'Delivered messages, failures, retries, and approvals appear in the timeline.'}
                    </div>
                    {attachmentsUploading && (
                        <span className="text-xs font-semibold text-slate-500">Uploading attachments…</span>
                    )}
                </div>
            </div>
        </div>
    );
}
