
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { logger } from '../backend/platform/utils/logger.js';
import { upsertCanonicalCustomerTemplates } from '../backend/modules/communications/app/customerTemplateCatalogService.js';
import { TENANT_IDS } from '../backend/platform/tenant/tenantConfig.js';

if (!process.env.DATABASE_URL) throw new Error('FATAL: DATABASE_URL is not set');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const SEEDED_PROGRAM_ID = '11111111-1111-4111-8111-111111111111';

const YEAR_BINDERS = [
    { id: 'ABBEYGATE0125-BINDER-2024', agreementNumber: 'ABBEYGATE0125-2024', umr: 'B176024EEA6152', startDate: new Date('2024-01-01T00:00:00.000Z'), endDate: new Date('2024-12-31T23:59:59.999Z') },
    { id: 'ABBEYGATE0125-BINDER-2025', agreementNumber: 'ABBEYGATE0125-2025', umr: 'B176025EEA6152', startDate: new Date('2025-01-01T00:00:00.000Z'), endDate: new Date('2025-12-31T23:59:59.999Z') },
    { id: 'ABBEYGATE0125-BINDER-2026', agreementNumber: 'ABBEYGATE0125-2026', umr: 'B176026EEA6152', startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: new Date('2026-12-31T23:59:59.999Z') },
] as const;

async function main() {
    await seedTenants();
    await upsertCanonicalCustomerTemplates();

    const commonPasswordRaw = 'FacioMGA2026';
    const hashedCommonPassword = await bcrypt.hash(commonPasswordRaw, 10);

    const admins = [
        { email: 'uriel@facio.io', name: 'Uriel Aharoni' },
        { email: 'admin@abbeygate.cy', name: 'Abbeygate Admin' }
    ];

    for (const admin of admins) {
        await prisma.user.upsert({
            where: { email: admin.email },
            update: {
                password: hashedCommonPassword,
                name: admin.name,
                role: Role.ADMIN,
            },
            create: {
                email: admin.email,
                password: hashedCommonPassword,
                name: admin.name,
                role: Role.ADMIN,
            },
        });
        logger.info({ email: admin.email, role: 'ADMIN' }, 'User seeded/updated');
    }

    // Create Underwriter User (Requested for testing)
    const underwriters = [
        { email: 'max@abbeygate.demo', name: 'Max Cohen' },
        { email: 'peter@abbeygate.cy', name: 'Peter Sheppard' },
        { email: 'liav@facio.io', name: 'Liav Geffen' },
        { email: 'danny@abbeygate.cy', name: 'Danny (Abbeygate CY)' },
        { email: 'andy@abbeygate.cy', name: 'Andy (Abbeygate CY)' },
        { email: 'andy@abbeygate.pt', name: 'Andy (Abbeygate PT)' },
        { email: 'ivan@abbeygate.pt', name: 'Ivan (Abbeygate PT)' }
    ];

    for (const uw of underwriters) {
        await prisma.user.upsert({
            where: { email: uw.email },
            update: {
                password: hashedCommonPassword,
                name: uw.name,
                role: Role.UNDERWRITER,
                isActive: true,
                mfaEnabled: true,
            },
            create: {
                email: uw.email,
                password: hashedCommonPassword,
                name: uw.name,
                role: Role.UNDERWRITER,
                isActive: true,
                mfaEnabled: true,
            },
        });
        logger.info({ email: uw.email, role: 'UNDERWRITER' }, 'User seeded/updated');
    }

    // Create Test Policy Holder
    await prisma.policyHolder.upsert({
        where: { id: 'ph-test-1' },
        update: {},
        create: {
            id: 'ph-test-1',
            operatingTenant: { connect: { id: TENANT_IDS.CY } },
            name: 'Test Policy Holder Ltd',
            segment: 'Auto Insurance',
            address: '123 Test St'
        }
    });

    // Create / upsert default Motor binder (used for Lloyd's v5.2 bordereaux exports)
    const program = await prisma.program.upsert({
        where: { id: SEEDED_PROGRAM_ID },
        update: {
            operatingTenantId: TENANT_IDS.CY,
            name: 'Abbeygate Motor Comprehensive',
            status: 'ACTIVE',
        },
        create: {
            id: SEEDED_PROGRAM_ID,
            operatingTenantId: TENANT_IDS.CY,
            name: 'Abbeygate Motor Comprehensive',
            status: 'ACTIVE',
        },
    });

    for (const binder of YEAR_BINDERS) {
        await prisma.binder.upsert({
            where: { id: binder.id },
            update: {
                operatingTenantId: TENANT_IDS.CY,
                coverholderName: 'Abbeygate UW Limited',
                coverholderPin: '115933OFE',
                umr: binder.umr,
                agreementNumber: binder.agreementNumber,
                lloydsReportingVer: 'V5.2',
                defaultCurrency: 'EUR',
                settlementCurrency: 'EUR',
                status: 'ACTIVE',
                startDate: binder.startDate,
                endDate: binder.endDate,
            },
            create: {
                id: binder.id,
                operatingTenantId: TENANT_IDS.CY,
                coverholderName: 'Abbeygate UW Limited',
                coverholderPin: '115933OFE',
                umr: binder.umr,
                agreementNumber: binder.agreementNumber,
                lloydsReportingVer: 'V5.2',
                defaultCurrency: 'EUR',
                settlementCurrency: 'EUR',
                status: 'ACTIVE',
                startDate: binder.startDate,
                endDate: binder.endDate,
            }
        });
        await prisma.programBinderLink.upsert({
            where: { programId_binderId: { programId: program.id, binderId: binder.id } },
            update: { status: 'ACTIVE' },
            create: {
                programId: program.id,
                binderId: binder.id,
                status: 'ACTIVE',
            },
        });
        logger.info({ binderId: binder.id, agreementNumber: binder.agreementNumber }, 'Year-specific binder seeded/updated');
    }

    // CLEANUP: Remove demo accounts if they exist
    const demoEmails = ['admin@abbeygate.io'];
    await prisma.user.deleteMany({
        where: {
            email: { in: demoEmails }
        }
    });
    logger.info('Removed demo accounts (admin@abbeygate.io)');

    // --- MagicB: Abbeygate Auto Insurance Quote (Phase 1 - validations) ---
    // Seed only if missing; safe to rerun.
    const slugs: Array<{ slug: string; title: string; dataType: string; jsonPath: string }> = [
        { slug: 'quote.firstName', title: 'First Name', dataType: 'string', jsonPath: 'quoteData.proposer.firstName' },
        { slug: 'quote.lastName', title: 'Last Name', dataType: 'string', jsonPath: 'quoteData.proposer.lastName' },
        { slug: 'quote.email', title: 'Email', dataType: 'string', jsonPath: 'quoteData.proposer.email' },
        { slug: 'quote.telephone', title: 'Telephone', dataType: 'string', jsonPath: 'quoteData.proposer.phone' },
        { slug: 'quote.dateOfBirth', title: 'Date of Birth', dataType: 'string', jsonPath: 'quoteData.proposer.dateOfBirth' },
        { slug: 'quote.addressLine', title: 'Address Line', dataType: 'string', jsonPath: 'quoteData.proposer.address.line1' },
        { slug: 'quote.city', title: 'City', dataType: 'string', jsonPath: 'quoteData.proposer.address.city' },
        { slug: 'quote.province', title: 'Province', dataType: 'string', jsonPath: 'quoteData.proposer.address.province' },
        { slug: 'quote.postCode', title: 'Post Code', dataType: 'string', jsonPath: 'quoteData.proposer.address.postcode' },
        { slug: 'quote.occupation', title: 'Occupation', dataType: 'string', jsonPath: 'quoteData.proposer.occupation' },
        { slug: 'quote.whereDidYouHear', title: 'Where did you hear about us?', dataType: 'string', jsonPath: 'quoteData.proposer.whereDidYouHear' },

        { slug: 'uw.licenseYears', title: 'License Years', dataType: 'string', jsonPath: 'quoteData.licenseYears' },
        { slug: 'uw.licenseType', title: 'License Type', dataType: 'string', jsonPath: 'quoteData.licenseType' },
        { slug: 'uw.licenseIssuedIn', title: 'License Issued In', dataType: 'string', jsonPath: 'quoteData.licenseIssuedIn' },

        { slug: 'vehicle.coverRequired', title: 'Cover Required', dataType: 'string', jsonPath: 'quoteData.coverRequired' },
        { slug: 'vehicle.make', title: 'Make', dataType: 'string', jsonPath: 'quoteData.make' },
        { slug: 'vehicle.model', title: 'Model', dataType: 'string', jsonPath: 'quoteData.model' },
        { slug: 'vehicle.year', title: 'Year', dataType: 'string', jsonPath: 'quoteData.year' },
        { slug: 'vehicle.engineSize', title: 'Engine Size', dataType: 'string', jsonPath: 'quoteData.engineSize' },
        { slug: 'vehicle.vehicleValue', title: 'Vehicle Value', dataType: 'number', jsonPath: 'quoteData.vehicleValue' },

        { slug: 'declarations.privacyPolicyAccepted', title: 'Privacy Policy Accepted', dataType: 'boolean', jsonPath: 'quoteData.proposer.privacyPolicyAccepted' }
    ];

    for (const s of slugs) {
        await prisma.magicB_Slug.upsert({
            where: { slug: s.slug },
            update: { title: s.title, dataType: s.dataType },
            create: { slug: s.slug, title: s.title, dataType: s.dataType }
        });

        // Ensure mapping exists
        const existingMapping = await prisma.magicB_StorageMapping.findFirst({ where: { slug: s.slug } });
        if (!existingMapping) {
            await prisma.magicB_StorageMapping.create({
                data: {
                    slug: s.slug,
                    bindingType: 'JSONB_PATH',
                    tableName: 'policy_state_current',
                    jsonPath: s.jsonPath
                }
            });
        }
    }

    // Minimal required rules per step (BLOCK severity)
    const requiredRules: Array<{ slug: string; step: string }> = [
        { slug: 'quote.firstName', step: 'policy-holder' },
        { slug: 'quote.lastName', step: 'policy-holder' },
        { slug: 'quote.email', step: 'policy-holder' },
        { slug: 'quote.telephone', step: 'policy-holder' },
        { slug: 'quote.dateOfBirth', step: 'policy-holder' },
        { slug: 'quote.addressLine', step: 'policy-holder' },
        { slug: 'quote.city', step: 'policy-holder' },
        { slug: 'quote.province', step: 'policy-holder' },
        { slug: 'quote.postCode', step: 'policy-holder' },

        { slug: 'quote.occupation', step: 'driving-history' },
        { slug: 'quote.whereDidYouHear', step: 'driving-history' },

        { slug: 'uw.licenseYears', step: 'driving-history' },
        { slug: 'uw.licenseType', step: 'driving-history' },
        { slug: 'uw.licenseIssuedIn', step: 'driving-history' },

        { slug: 'vehicle.coverRequired', step: 'vehicle-cover' },
        { slug: 'vehicle.make', step: 'vehicle-cover' },
        { slug: 'vehicle.model', step: 'vehicle-cover' },
        { slug: 'vehicle.year', step: 'vehicle-cover' },
        { slug: 'vehicle.engineSize', step: 'vehicle-cover' }
    ];

    for (const r of requiredRules) {
        const exists = await prisma.magicB_Rule.findFirst({
            where: {
                slug: r.slug,
                ruleType: 'REQUIRED',
                contextFilter: { equals: { workflowStep: 'QUOTE', step: r.step } }
            }
        });
        if (!exists) {
            await prisma.magicB_Rule.create({
                data: {
                    slug: r.slug,
                    ruleType: 'REQUIRED',
                    contextFilter: { workflowStep: 'QUOTE', step: r.step },
                    ruleBody: { op: 'required' },
                    severity: 'BLOCK'
                }
            });
        }
    }

    // Format validation rules
    const emailRuleExists = await prisma.magicB_Rule.findFirst({
        where: {
            slug: 'quote.email',
            ruleType: 'VALIDATION',
            contextFilter: { equals: { workflowStep: 'QUOTE' } }
        }
    });
    if (!emailRuleExists) {
        await prisma.magicB_Rule.create({
            data: {
                slug: 'quote.email',
                ruleType: 'VALIDATION',
                contextFilter: { workflowStep: 'QUOTE' },
                ruleBody: { op: 'regex', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
                severity: 'BLOCK'
            }
        });
    }
}

async function seedTenants() {
    // Four production tenants — one per active Lloyd's jurisdiction.
    // Field values are the canonical defaults from tenantConfig.ts / regionConfig.ts.
    // Greece's allowedRiskCountries intentionally includes 'Greece' to close the
    // latent motor UW bug (the engine will enforce it fully in Sprint 4).
    const tenants = [
        {
            id: TENANT_IDS.CY,
            tenantSlug: 'abbeygate-cy',
            kind: 'PRODUCTION' as const,
            status: 'ACTIVE' as const,
            countryCode: 'CY',
            country: 'Cyprus',
            currency: 'EUR',
            // Cyprus binders (Home + Travel) carry no policy-level IPT —
            // the legacy schedules show Local Taxes / Tax Fee = 0.00.
            iptJson: { flatFee: 0 },
            adminFee: 18,
            legalPack: 'cy',
            publicBaseUrl: 'https://abbeygate-cy.facio.io',
            fromEmail: 'no-reply@abbeygate.cy',
            brandLogos: null,
            priorityCountries: ['Cyprus', 'Portugal', 'Spain', 'United Kingdom'],
            allowedRiskCountries: ['Cyprus', 'Portugal', 'Spain', 'Greece'],
            // Canonical Nationality contract — country name only.
            defaultNationality: 'United Kingdom',
            defaultDriversLicenseCountry: 'United Kingdom',
            defaultBrokerName: 'Abbeygate',
            authority: null,
            parentOrganizationId: null,
        },
        {
            id: TENANT_IDS.PT,
            tenantSlug: 'abbeygate-pt',
            kind: 'PRODUCTION' as const,
            status: 'ACTIVE' as const,
            countryCode: 'PT',
            country: 'Portugal',
            currency: 'EUR',
            iptJson: { rate: 0.09 },
            adminFee: 18,
            legalPack: 'pt',
            publicBaseUrl: 'https://abbeygate-pt.facio.io',
            fromEmail: 'no-reply@abbeygate.pt',
            brandLogos: null,
            priorityCountries: ['Portugal', 'Spain', 'Cyprus', 'United Kingdom'],
            allowedRiskCountries: ['Cyprus', 'Portugal', 'Spain', 'Greece'],
            defaultNationality: 'United Kingdom',
            defaultDriversLicenseCountry: 'United Kingdom',
            defaultBrokerName: 'Abbeygate',
            authority: null,
            parentOrganizationId: null,
        },
        {
            id: TENANT_IDS.GR,
            tenantSlug: 'abbeygate-gr',
            kind: 'PRODUCTION' as const,
            status: 'ACTIVE' as const,
            countryCode: 'GR',
            country: 'Greece',
            currency: 'EUR',
            iptJson: { rate: 0.15 },
            adminFee: 18,
            legalPack: 'gr',
            publicBaseUrl: 'https://abbeygate-gr.facio.io',
            fromEmail: 'no-reply@abbeygate.gr',
            brandLogos: null,
            priorityCountries: ['Greece', 'Cyprus', 'Portugal', 'United Kingdom'],
            // Greece included — closes the latent motor UW allowedRiskCountries bug.
            allowedRiskCountries: ['Cyprus', 'Portugal', 'Spain', 'Greece'],
            defaultNationality: 'United Kingdom',
            defaultDriversLicenseCountry: 'United Kingdom',
            defaultBrokerName: 'Abbeygate',
            authority: null,
            parentOrganizationId: null,
        },
        {
            id: TENANT_IDS.ES,
            tenantSlug: 'abbeygate-es',
            kind: 'PRODUCTION' as const,
            status: 'ACTIVE' as const,
            countryCode: 'ES',
            country: 'Spain',
            currency: 'EUR',
            iptJson: { rate: 0.0815 },
            adminFee: 18,
            legalPack: 'es',
            publicBaseUrl: 'https://abbeygate-es.facio.io',
            fromEmail: 'no-reply@abbeygate.es',
            brandLogos: null,
            priorityCountries: ['Spain', 'Portugal', 'Cyprus', 'United Kingdom'],
            allowedRiskCountries: ['Cyprus', 'Portugal', 'Spain', 'Greece'],
            defaultNationality: 'United Kingdom',
            defaultDriversLicenseCountry: 'United Kingdom',
            defaultBrokerName: 'Abbeygate',
            authority: null,
            parentOrganizationId: null,
        },
    ];

    for (const t of tenants) {
        await prisma.tenant.upsert({
            where: { tenantSlug: t.tenantSlug },
            update: {
                kind: t.kind,
                status: t.status,
                countryCode: t.countryCode,
                country: t.country,
                currency: t.currency,
                iptJson: t.iptJson,
                adminFee: t.adminFee,
                legalPack: t.legalPack,
                publicBaseUrl: t.publicBaseUrl,
                fromEmail: t.fromEmail,
                priorityCountries: t.priorityCountries,
                allowedRiskCountries: t.allowedRiskCountries,
                defaultNationality: t.defaultNationality,
                defaultDriversLicenseCountry: t.defaultDriversLicenseCountry,
                defaultBrokerName: t.defaultBrokerName,
            },
            create: t,
        });
        logger.info({ tenantSlug: t.tenantSlug }, 'Tenant seeded/updated');
    }
}

main()
    .catch((e) => {
        logger.error({ err: e }, 'Seed script failed');
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
