/**
 * Raw SMTP client using Node.js net/tls sockets.
 *
 * Extracted from the god-file `queue.ts` during CHAMPS decomposition.
 * Used by email worker handlers for direct SMTP delivery.
 */

import net from 'net';
import tls from 'tls';

function b64(s: string) {
    return Buffer.from(s, 'utf8').toString('base64');
}

interface SmtpAttachment {
    filename: string;
    contentBase64: string;
    mimetype?: string;
}

function sanitizeHeader(value: string): string {
    return value.replace(/[\r\n"]/g, '').trim();
}

function wrapBase64(value: string): string {
    return value.replace(/\s+/g, '').replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

function buildMimeMessage(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
    replyTo?: string;
    attachments?: SmtpAttachment[];
}): string {
    const attachments = (params.attachments || []).filter((item) => item.filename && item.contentBase64);
    const replyTo = params.replyTo ? `Reply-To: ${sanitizeHeader(params.replyTo)}\r\n` : '';
    const headers =
        `From: ${sanitizeHeader(params.from)}\r\n` +
        `To: ${sanitizeHeader(params.to)}\r\n` +
        replyTo +
        `Subject: ${sanitizeHeader(params.subject)}\r\n` +
        `MIME-Version: 1.0\r\n`;

    if (!attachments.length) {
        return headers +
            `Content-Type: text/plain; charset="utf-8"\r\n` +
            `\r\n` +
            `${params.text}\r\n`;
    }

    const boundary = `facio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const textPart =
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset="utf-8"\r\n` +
        `Content-Transfer-Encoding: 8bit\r\n` +
        `\r\n` +
        `${params.text}\r\n`;
    const attachmentParts = attachments.map((attachment) => {
        const filename = sanitizeHeader(attachment.filename);
        return `--${boundary}\r\n` +
            `Content-Type: ${sanitizeHeader(attachment.mimetype || 'application/octet-stream')}; name="${filename}"\r\n` +
            `Content-Disposition: attachment; filename="${filename}"\r\n` +
            `Content-Transfer-Encoding: base64\r\n` +
            `\r\n` +
            `${wrapBase64(attachment.contentBase64)}\r\n`;
    }).join('');

    return headers +
        `Content-Type: multipart/mixed; boundary="${boundary}"\r\n` +
        `\r\n` +
        textPart +
        attachmentParts +
        `--${boundary}--\r\n`;
}

export async function smtpSendMail(params: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
    to: string;
    subject: string;
    text: string;
    replyTo?: string;
    attachments?: SmtpAttachment[];
}) {
    const { host, port, secure, user, pass, from, to, subject, text, replyTo, attachments } = params;

    const socket: net.Socket | tls.TLSSocket = secure
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });

    socket.setEncoding('utf8');

    let buffer = '';
    const readLine = async (): Promise<string> =>
        new Promise((resolve, reject) => {
            const onData = (chunk: string) => {
                buffer += chunk;
                const idx = buffer.indexOf('\n');
                if (idx !== -1) {
                    const line = buffer.slice(0, idx + 1);
                    buffer = buffer.slice(idx + 1);
                    cleanup();
                    resolve(line.trimEnd());
                }
            };
            const onErr = (e: unknown) => { cleanup(); reject(e); };
            const onEnd = () => { cleanup(); reject(new Error('SMTP connection closed')); };
            const cleanup = () => {
                socket.off('data', onData);
                socket.off('error', onErr);
                socket.off('end', onEnd);
            };
            socket.on('data', onData);
            socket.on('error', onErr);
            socket.on('end', onEnd);
        });

    const write = async (line: string) => {
        socket.write(line + '\r\n');
    };

    const expect = async (codePrefix: string) => {
        const line = await readLine();
        if (!line.startsWith(codePrefix)) {
            throw new Error(`SMTP expected ${codePrefix} but got: ${line}`);
        }
        return line;
    };

    await expect('220');
    await write(`EHLO facio`);
    // EHLO can return multi-line 250-...; consume until final 250 <text>
    while (true) {
        const l = await readLine();
        if (l.startsWith('250 ')) break;
        if (!l.startsWith('250-')) break;
    }

    if (user && pass) {
        await write('AUTH LOGIN');
        await expect('334');
        await write(b64(user));
        await expect('334');
        await write(b64(pass));
        await expect('235');
    }

    await write(`MAIL FROM:<${from}>`);
    await expect('250');
    await write(`RCPT TO:<${to}>`);
    await expect('250');
    await write('DATA');
    await expect('354');

    const msg = buildMimeMessage({ from, to, subject, text, replyTo, attachments });

    socket.write(msg);
    await write('.');
    await expect('250');
    await write('QUIT');
    // Best-effort close
    socket.end();
}
