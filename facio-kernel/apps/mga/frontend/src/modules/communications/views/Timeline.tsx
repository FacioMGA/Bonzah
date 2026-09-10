import { useEffect, useRef } from 'react';
import { TimelineEventCard } from './TimelineEventCard';
import type { CommunicationTimelineItem, CommunicationUser } from '../model/types';

interface TimelineProps {
    items: CommunicationTimelineItem[];
    users?: CommunicationUser[];
    onRetry?: (messageId: string) => void;
    onApprove?: (messageId: string) => void;
    onReject?: (messageId: string) => void;
}

export function Timeline({ items, users = [], onRetry, onApprove, onReject }: TimelineProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [items.length]);

    if (!items.length) {
        return (
            <div className="flex h-full min-h-[360px] items-center justify-center px-6 py-12 text-center text-sm font-medium text-slate-400">
                No communication history yet. Start a thread from the composer below.
            </div>
        );
    }

    return (
        <div ref={scrollRef} className="h-full overflow-y-auto">
            <div className="flex flex-col gap-6 px-5 py-6">
                {items.map((item, index) => (
                    <TimelineEventCard
                        key={item.id}
                        item={item}
                        users={users}
                        showConnector={index < items.length - 1}
                        onRetry={onRetry}
                        onApprove={onApprove}
                        onReject={onReject}
                    />
                ))}
            </div>
        </div>
    );
}
