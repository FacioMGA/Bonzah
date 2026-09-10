/**
 * Email Infrastructure — Shared utilities for all email templates.
 *
 * Owns: SendGrid initialization, inline logo loading, escapeHtml, FROM_EMAIL constant.
 * CHAMPS: Extracted from the monolithic email.ts to enable per-domain template files.
 */
import sgMail from '@sendgrid/mail';
import type { MailDataRequired } from '@sendgrid/helpers/classes/mail.js';
import { readFile } from 'node:fs/promises';
import { logger } from '../../../../platform/utils/logger.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';

let _sendgridReady = false;

export type UnknownRecord = Record<string, unknown>;
export const asRecord = (value: unknown): UnknownRecord =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

const POLICY_WELCOME_WHITE_LOGO_PATH = new URL(
  '../../../../public/assets/abbeygate_logo_white.png',
  import.meta.url,
);
const POLICY_WELCOME_BLUE_LOGO_PATH = new URL(
  '../../../../public/assets/abbeygate_logo_full.png',
  import.meta.url,
);

export type InlineLogoAttachment = {
    filename: string;
    content: Buffer;
    contentType: string;
    contentId: string;
};

const policyWelcomeInlineLogosByTenant = new Map<string, Promise<InlineLogoAttachment[]>>();

function resolveEmailBranding() {
    const tenant = getTenantConfig();
    const tenantSlug = tenant.tenantSlug.toLowerCase();
    return {
        tenantSlug,
        whiteLogoCid: `${tenantSlug}-logo-white`,
        blueLogoCid: `${tenantSlug}-logo-blue`,
    };
}

export async function loadPolicyWelcomeInlineLogos(): Promise<InlineLogoAttachment[]> {
    const branding = resolveEmailBranding();
    let promise = policyWelcomeInlineLogosByTenant.get(branding.tenantSlug);
    if (!promise) {
        promise = (async () => {
            try {
                const [whiteLogo, blueLogo] = await Promise.all([
                    readFile(POLICY_WELCOME_WHITE_LOGO_PATH),
                    readFile(POLICY_WELCOME_BLUE_LOGO_PATH),
                ]);
                return [
                    {
                        filename: 'abbeygate_logo_white.png',
                        content: whiteLogo,
                        contentType: 'image/png',
                        contentId: branding.whiteLogoCid,
                    },
                    {
                        filename: 'abbeygate_logo_full.png',
                        content: blueLogo,
                        contentType: 'image/png',
                        contentId: branding.blueLogoCid,
                    },
                ];
            } catch (error) {
                logger.warn({ err: error }, '[Email] Failed loading inline policy email logos; falling back to remote image URLs.');
                return [];
            }
        })();
        policyWelcomeInlineLogosByTenant.set(branding.tenantSlug, promise);
    }
    return promise;
}

export function ensureSendGrid() {
    const key = process.env.SENDGRID_API_KEY;
    if (!_sendgridReady && key) {
        sgMail.setApiKey(key);
        _sendgridReady = true;
    }
    return Boolean(key);
}

export function escapeHtml(s: string) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Re-export sgMail and MailDataRequired for use by template files
export { sgMail, logger };
export type { MailDataRequired };
