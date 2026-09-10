import puppeteer, { Browser } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let _browser: Browser | null = null;

/**
 * Close the shared Puppeteer browser instance.
 *
 * Important for tests (Vitest) so the runner can exit cleanly without
 * "open handles" caused by a long-lived Chromium process.
 */
export async function closePdfBrowser() {
    if (!_browser) return;
    const browser = _browser;
    _browser = null;
    try {
        // Avoid test-suite teardown hangs if Chromium shutdown stalls.
        const timeoutMs = Math.max(1000, Number(process.env.PDF_BROWSER_CLOSE_TIMEOUT_MS || 4000));
        await Promise.race([
            (async () => {
                try {
                    const pages = await browser.pages();
                    await Promise.allSettled((pages || []).map((p) => p.close().catch(() => undefined)));
                } catch {
                    // ignore
                }
                await browser.close();
            })(),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
    } catch {
        // ignore
    } finally {
        try {
            if (browser.connected) void browser.disconnect();
        } catch {
            // ignore
        }
    }
}

// -----------------------------------------------------------------------------
// PDF CONCURRENCY GATE (prevents OOM under load)
// -----------------------------------------------------------------------------
class Semaphore {
    private permits: number;
    private waiters: Array<() => void> = [];
    constructor(permits: number) {
        this.permits = Math.max(1, Math.floor(permits || 1));
    }
    async acquire(): Promise<() => void> {
        if (this.permits > 0) {
            this.permits -= 1;
            return () => this.release();
        }
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        this.permits -= 1;
        return () => this.release();
    }
    private release() {
        this.permits += 1;
        const next = this.waiters.shift();
        if (next) next();
    }
}

const PDF_MAX_CONCURRENCY = Number(process.env.PDF_MAX_CONCURRENCY || 2);
const pdfSemaphore = new Semaphore(Number.isFinite(PDF_MAX_CONCURRENCY) ? PDF_MAX_CONCURRENCY : 2);

function firstExistingPath(paths: Array<string | undefined | null>) {
    for (const p of paths) {
        if (!p) continue;
        try {
            if (fs.existsSync(p)) return p;
        } catch {
            // ignore
        }
    }
    return undefined;
}

function resolveExecutablePath(): string | undefined {
    // 1) Explicit override
    const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();

    // 2) Common system locations (works well for local dev)
    const candidates: string[] = [
        // macOS
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        // Linux (common)
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        // Windows (best-effort; not used in our env but harmless)
        'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
        'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    ];

    return firstExistingPath(candidates);
}

async function getBrowser() {
    if (!_browser) {
        const executablePath = resolveExecutablePath();
        _browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--font-render-hinting=none',
                // Required for loading `file://` assets/styles when using `page.setContent`.
                '--allow-file-access-from-files',
            ],
            executablePath,
        });
    }
    return _browser;
}

interface PdfOptions {
    html: string;
    headerTemplate?: string;
    footerTemplate?: string;
    landscape?: boolean;
    margin?: {
        top?: string;
        bottom?: string;
        left?: string;
        right?: string;
    };
}

// -----------------------------------------------------------------------------
// TEMPLATE/CSS/ASSET CACHES (avoid sync I/O in hot path)
// -----------------------------------------------------------------------------
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.join(moduleDir, 'templates');
const cssPath = path.join(templatesRoot, 'styles/pdf-theme.css');
const assetsDir = path.join(templatesRoot, 'assets');

let THEME_CSS = '';
const ASSET_DATA_URIS = new Map<string, string>(); // filename -> data uri
const TEMPLATE_CACHE = new Map<string, string>(); // template file -> content

function bufferToDataUri(filename: string, buf: Buffer): string | null {
    const ext = path.extname(filename).toLowerCase();
    const b64 = Buffer.from(buf).toString('base64');
    if (ext === '.svg') return `data:image/svg+xml;base64,${b64}`;
    if (ext === '.png') return `data:image/png;base64,${b64}`;
    if (ext === '.jpg' || ext === '.jpeg') return `data:image/jpeg;base64,${b64}`;
    if (ext === '.webp') return `data:image/webp;base64,${b64}`;
    return null;
}

// Preload once at module init (startup-only blocking, not per request)
try {
    THEME_CSS = fs.readFileSync(cssPath, 'utf-8');
} catch {
    THEME_CSS = '';
}
try {
    const assetFiles = fs.readdirSync(assetsDir);
    for (const f of assetFiles) {
        const abs = path.join(assetsDir, f);
        try {
            const buf = fs.readFileSync(abs);
            const uri = bufferToDataUri(f, buf);
            if (uri) ASSET_DATA_URIS.set(f, uri);
        } catch {
            // ignore individual asset failures
        }
    }
} catch {
    // ignore
}

function inlineThemeAndAssets(html: string): string {
    let out = html;

    if (THEME_CSS) {
        out = out.replace(
            /<link\s+rel=["']stylesheet["']\s+href=["']styles\/pdf-theme\.css["']\s*\/?>/gi,
            `<style>\n${THEME_CSS}\n</style>`
        );
    }

    out = out.replace(/src=["']assets\/([^"']+)["']/gi, (_m, filename) => {
        const key = String(filename);
        const uri = ASSET_DATA_URIS.get(key);
        if (!uri) return `src="assets/${key}"`;
        return `src="${uri}"`;
    });

    // Remove base tag (no longer required once everything is embedded).
    out = out.replace(/<base\b[^>]*>/gi, '');

    return out;
}

export async function renderHtmlToPdf(options: PdfOptions): Promise<Buffer> {
    const release = await pdfSemaphore.acquire();
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        const html = inlineThemeAndAssets(options.html);
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue();
            else void request.abort('blockedbyclient');
        });
        // 1. Set Content. Assets are inlined before render and fonts are
        // awaited explicitly below, so `load` avoids brittle network-idle
        // waits on long document templates.
        await page.setContent(html, { waitUntil: 'load' });

        // 2. Wait for Fonts
        await page.evaluateHandle('document.fonts.ready');

        // 3. Emulate Print Media
        await page.emulateMediaType('print');

        // 4. Generate PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: options.landscape || false,
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: options.headerTemplate || '<div></div>',
            footerTemplate: options.footerTemplate || '<div></div>',
            margin: {
                top: options.margin?.top || '28mm',
                bottom: options.margin?.bottom || '28mm',
                left: options.margin?.left || '24mm',
                right: options.margin?.right || '24mm',
            },
            preferCSSPageSize: true, // Respect @page properties
        });

        return Buffer.from(pdfBuffer);
    } finally {
        await page.close();
        release();
    }
}

// Helper to load templates
export function loadTemplate(name: string): string {
    const cached = TEMPLATE_CACHE.get(name);
    if (cached) return cached;
    const p = path.join(templatesRoot, name);
    const txt = fs.readFileSync(p, 'utf-8');
    TEMPLATE_CACHE.set(name, txt);
    return txt;
}
