import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type {
    SubjectEntityType,
    ResolvedRecipient,
    ParticipantRole,
    CommunicationChannel,
} from '../domain/types.js';

type ConsentMap = Record<string, boolean>;

/**
 * RecipientResolver — resolves who can be contacted for a given subject entity.
 *
 * Sources:
 * 1. CommunicationParticipant registry (explicit overrides)
 * 2. Subject-specific fallback resolution (policyholder from quoteData, claim pros, etc.)
 * 3. Internal users (underwriters, admins)
 *
 * This replaces the ad-hoc frontend recipient list building.
 */
export class RecipientResolver {
    /**
     * Resolve all contactable participants for a subject entity.
     */
    static async resolveForSubject(
        entityType: SubjectEntityType,
        entityId: string,
    ): Promise<ResolvedRecipient[]> {
        const recipients: ResolvedRecipient[] = [];
        const seenAddresses = new Set<string>();

        // 1. Explicit participant registry
        const participants = await tenantScopedPrisma.communicationParticipant.findMany({
            where: { entityType: String(entityType), entityId },
        });

        for (const p of participants) {
            const consent = (p.consent as ConsentMap) ?? {};
            if (p.email && !seenAddresses.has(p.email)) {
                seenAddresses.add(p.email);
                recipients.push({
                    participantId: p.id,
                    contactName: p.contactName,
                    role: p.contactRole as ParticipantRole,
                    channel: 'EMAIL' as CommunicationChannel,
                    address: p.email,
                    consent: consent.email !== false,
                    recipientClass: String(p.contactRole || '').toUpperCase() === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL',
                    groupLabel: String(p.contactRole || '').toUpperCase() === 'INTERNAL' ? 'Internal team' : 'Contact',
                    source: 'participant',
                    preferredChannel: (String(p.preferred || '').trim().toUpperCase() || 'EMAIL') as CommunicationChannel,
                });
            }
            if (p.phone && !seenAddresses.has(p.phone)) {
                seenAddresses.add(p.phone);
                // Add phone for SMS
                recipients.push({
                    participantId: p.id,
                    contactName: p.contactName,
                    role: p.contactRole as ParticipantRole,
                    channel: 'SMS' as CommunicationChannel,
                    address: p.phone,
                    consent: consent.sms !== false,
                    recipientClass: 'EXTERNAL',
                    groupLabel: 'Contact',
                    source: 'participant',
                    preferredChannel: (String(p.preferred || '').trim().toUpperCase() || 'SMS') as CommunicationChannel,
                    disabledReason: consent.sms === false ? 'SMS consent not granted' : undefined,
                });
                // Add phone for WhatsApp if consent
                if (consent.whatsapp !== false) {
                    recipients.push({
                        participantId: p.id,
                        contactName: p.contactName,
                        role: p.contactRole as ParticipantRole,
                        channel: 'WHATSAPP' as CommunicationChannel,
                        address: p.phone,
                        consent: true,
                        recipientClass: 'EXTERNAL',
                        groupLabel: 'Contact',
                        source: 'participant',
                        preferredChannel: (String(p.preferred || '').trim().toUpperCase() || 'WHATSAPP') as CommunicationChannel,
                    });
                }
            }
        }

        // 2. Subject-specific fallback resolution
        switch (entityType) {
            case 'POLICY':
            case 'QUOTE':
                await this.resolveFromPolicy(entityId, recipients, seenAddresses);
                break;
            case 'CLAIM':
                await this.resolveFromClaim(entityId, recipients, seenAddresses);
                break;
            case 'ACCOUNT':
                await this.resolveFromAccount(entityId, recipients, seenAddresses);
                break;
        }

        // 3. Internal users (underwriters + admins)
        await this.resolveInternalUsers(recipients, seenAddresses);

        return recipients;
    }

    // ── Policy-level resolution ─────────────────────────────────────────
    private static async resolveFromPolicy(
        policyId: string,
        recipients: ResolvedRecipient[],
        seen: Set<string>,
    ) {
        const policy = await tenantScopedPrisma.policy.findUnique({
            where: { id: policyId },
            select: { quoteData: true, policyHolderId: true },
        });
        if (!policy?.quoteData || typeof policy.quoteData !== 'object') return;

        const qd = policy.quoteData as Record<string, unknown>;
        const proposer = (qd.proposer && typeof qd.proposer === 'object' ? qd.proposer : {}) as Record<string, unknown>;
        const name = [proposer.firstName, proposer.lastName].filter(Boolean).join(' ') || 'Policyholder';
        const email = String(proposer.email || '').trim();
        const phone = String(proposer.phone || qd.mobileNumber || '').trim();

        if (email && !seen.has(email)) {
            seen.add(email);
            recipients.push({
                participantId: `policy:${policyId}`,
                contactName: name,
                role: 'POLICYHOLDER',
                channel: 'EMAIL',
                address: email,
                consent: true,
                recipientClass: 'EXTERNAL',
                groupLabel: 'Policyholder',
                source: 'policy',
                preferredChannel: 'EMAIL',
                isPrimary: true,
            });
        }
        if (phone && !seen.has(phone)) {
            seen.add(phone);
            recipients.push({
                participantId: `policy:${policyId}`,
                contactName: name,
                role: 'POLICYHOLDER',
                channel: 'SMS',
                address: phone,
                consent: true,
                recipientClass: 'EXTERNAL',
                groupLabel: 'Policyholder',
                source: 'policy',
                preferredChannel: 'SMS',
                isPrimary: true,
            });
            recipients.push({
                participantId: `policy:${policyId}:whatsapp`,
                contactName: name,
                role: 'POLICYHOLDER',
                channel: 'WHATSAPP',
                address: phone,
                consent: true,
                recipientClass: 'EXTERNAL',
                groupLabel: 'Policyholder',
                source: 'policy',
                preferredChannel: 'WHATSAPP',
                isPrimary: true,
            });
        }
    }

    // ── Claim-level resolution ──────────────────────────────────────────
    private static async resolveFromClaim(
        claimId: string,
        recipients: ResolvedRecipient[],
        seen: Set<string>,
    ) {
        const claim = await tenantScopedPrisma.claim.findUnique({
            where: { id: claimId },
            select: {
                policyId: true,
                data: true,
                assignments: {
                    where: { status: 'ACTIVE' },
                    include: { pro: true },
                },
            },
        });
        if (!claim) return;

        // Resolve policyholder from linked policy
        if (claim.policyId) {
            await this.resolveFromPolicy(claim.policyId, recipients, seen);
        }

        // Resolve assigned claim professionals (adjusters, lawyers, etc.)
        for (const assignment of claim.assignments) {
            if (!assignment.pro) continue;
            const pro = assignment.pro;

            if (pro.email && !seen.has(pro.email)) {
                seen.add(pro.email);
                recipients.push({
                    participantId: `pro:${pro.id}`,
                    contactName: pro.name,
                    role: (assignment.role?.toUpperCase() === 'ADJUSTER'
                        ? 'ADJUSTER'
                        : 'BROKER') as ParticipantRole,
                    channel: 'EMAIL',
                    address: pro.email,
                    consent: true,
                    recipientClass: 'EXTERNAL',
                    groupLabel: 'Claim professionals',
                    source: 'claim',
                    preferredChannel: 'EMAIL',
                });
            }
            if (pro.phone && !seen.has(pro.phone)) {
                seen.add(pro.phone);
                recipients.push({
                    participantId: `pro:${pro.id}`,
                    contactName: pro.name,
                    role: (assignment.role?.toUpperCase() === 'ADJUSTER'
                        ? 'ADJUSTER'
                        : 'BROKER') as ParticipantRole,
                    channel: 'SMS',
                    address: pro.phone,
                    consent: true,
                    recipientClass: 'EXTERNAL',
                    groupLabel: 'Claim professionals',
                    source: 'claim',
                    preferredChannel: 'SMS',
                });
                recipients.push({
                    participantId: `pro:${pro.id}:whatsapp`,
                    contactName: pro.name,
                    role: (assignment.role?.toUpperCase() === 'ADJUSTER'
                        ? 'ADJUSTER'
                        : 'BROKER') as ParticipantRole,
                    channel: 'WHATSAPP',
                    address: pro.phone,
                    consent: true,
                    recipientClass: 'EXTERNAL',
                    groupLabel: 'Claim professionals',
                    source: 'claim',
                    preferredChannel: 'WHATSAPP',
                });
            }
        }

        // Resolve claimant from claim data (if different from policyholder)
        if (claim.data && typeof claim.data === 'object') {
            const cd = claim.data as Record<string, unknown>;
            const claimantEmail = String(cd.claimantEmail || '').trim();
            const claimantName = String(cd.claimantName || 'Claimant').trim();

            if (claimantEmail && !seen.has(claimantEmail)) {
                seen.add(claimantEmail);
                recipients.push({
                    participantId: `claim:${claimId}:claimant`,
                    contactName: claimantName,
                    role: 'CLAIMANT',
                    channel: 'EMAIL',
                    address: claimantEmail,
                    consent: true,
                    recipientClass: 'EXTERNAL',
                    groupLabel: 'Claimant',
                    source: 'claim',
                    preferredChannel: 'EMAIL',
                });
            }
        }
    }

    // ── Account-level resolution ────────────────────────────────────────
    private static async resolveFromAccount(
        accountId: string,
        recipients: ResolvedRecipient[],
        seen: Set<string>,
    ) {
        // AccountUser is an identity join; establish ownership through its RLS-
        // protected parent before projecting any user's contact information.
        if (!await tenantScopedPrisma.account.findUnique({ where: { id: accountId }, select: { id: true } })) return;
        const accountUsers = await prisma.accountUser.findMany({
            where: { accountId },
            include: { user: { select: { id: true, name: true, email: true } } },
        });

        for (const au of accountUsers) {
            if (!au.user?.email || seen.has(au.user.email)) continue;
            seen.add(au.user.email);
            recipients.push({
                participantId: `account-user:${au.user.id}`,
                contactName: au.user.name || au.user.email,
                role: 'POLICYHOLDER',
                channel: 'EMAIL',
                address: au.user.email,
                consent: true,
                recipientClass: 'EXTERNAL',
                groupLabel: 'Account users',
                source: 'account',
                preferredChannel: 'EMAIL',
            });
        }
    }

    // ── Internal users ──────────────────────────────────────────────────
    private static async resolveInternalUsers(
        recipients: ResolvedRecipient[],
        seen: Set<string>,
    ) {
        const internalUsers = await prisma.user.findMany({
            where: {
                role: { in: ['ADMIN', 'UNDERWRITER'] },
                isActive: true,
                suspendedAt: null,
                ...(process.env.KERNEL_PLATFORM_MODE === 'true' ? {
                    platformTenantMemberships: { some: { operatingTenantId: getTenantConfig().id, active: true } },
                } : {}),
            },
            select: { id: true, name: true, email: true, role: true },
        });

        for (const u of internalUsers) {
            if (!u.email || seen.has(u.email)) continue;
            seen.add(u.email);
            recipients.push({
                participantId: `user:${u.id}`,
                contactName: u.name || u.email,
                role: u.role === 'UNDERWRITER' ? 'UNDERWRITER' : 'INTERNAL' as ParticipantRole,
                channel: 'EMAIL',
                address: u.email,
                consent: true,
                recipientClass: 'INTERNAL',
                groupLabel: 'Internal team',
                source: 'internal',
                preferredChannel: 'EMAIL',
            });
        }
    }
}
