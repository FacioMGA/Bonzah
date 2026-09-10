/**
 * SSE client for the /api/mcp/config/stream endpoint.
 *
 * The BO conversation panel uses this to render each tool call as it
 * executes — `tool_call`, `tool_result`, `tool_error` are surfaced as
 * separate UI rows so the demo proves config tools are running in
 * structured steps (spec §17).
 */
export type StreamEventKind =
    | 'session_started'
    | 'session_finished'
    | 'tool_call'
    | 'tool_result'
    | 'tool_error';

export interface StreamEvent {
    kind: StreamEventKind;
    data: unknown;
}

export interface StreamToolCall {
    toolName: string;
    input: unknown;
}

export async function streamToolCalls(
    toolCalls: StreamToolCall[],
    options: {
        sessionId?: string;
        onEvent: (event: StreamEvent) => void;
        signal?: AbortSignal;
    },
): Promise<void> {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const response = await fetch('/api/mcp/config/stream', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'X-Facio-Surface': 'bo',
        },
        body: JSON.stringify({
            toolCalls,
            sessionId: options.sessionId,
            channel: 'internal-demo',
        }),
        signal: options.signal,
    });

    if (!response.ok || !response.body) {
        throw new Error(`MCP stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separatorIdx: number;
        while ((separatorIdx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, separatorIdx);
            buffer = buffer.slice(separatorIdx + 2);
            const parsed = parseSseFrame(rawEvent);
            if (parsed) options.onEvent(parsed);
        }
    }
}

function parseSseFrame(frame: string): StreamEvent | null {
    const lines = frame.split('\n');
    let eventName: StreamEventKind | undefined;
    let dataLine = '';
    for (const line of lines) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim() as StreamEventKind;
        else if (line.startsWith('data: ')) dataLine += line.slice(6);
    }
    if (!eventName) return null;
    try {
        const data = dataLine ? JSON.parse(dataLine) : null;
        return { kind: eventName, data };
    } catch {
        return null;
    }
}
