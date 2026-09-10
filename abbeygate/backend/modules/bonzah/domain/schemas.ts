import { z } from 'zod';
import { RENTAL_COVERAGE_CODES, RENTAL_POWERTRAINS, RENTAL_PROTECTION_PACKAGE_CODES, RENTAL_REPAIR_PROFILES, RENTAL_VEHICLE_CLASSES } from '@facio/products';

const vehicleSchema = z.object({
  id: z.string().optional(), year: z.number().int().min(2000).max(2030), make: z.string().min(1), model: z.string().min(1),
  class: z.enum(RENTAL_VEHICLE_CLASSES), declaredValue: z.number().positive().max(500_000),
  repairProfile: z.enum(RENTAL_REPAIR_PROFILES), powertrain: z.enum(RENTAL_POWERTRAINS),
}).strict();

export const rentalQuoteBodySchema = z.object({
  programId: z.string().min(1), channel: z.enum(['WEB', 'API']), effectiveDate: z.string().min(10),
  risk: z.object({
    pickup: z.object({ country: z.literal('US'), state: z.string().length(2), location: z.string().optional() }),
    residence: z.object({ country: z.literal('US'), state: z.string().length(2) }),
    rentalStart: z.string().datetime({ offset: true }), rentalEnd: z.string().datetime({ offset: true }),
    driver: z.object({ age: z.number().int().min(18).max(100), licenceValid: z.boolean(), additionalDriversListed: z.boolean().default(false), additionalDrivers: z.array(z.object({ fullName: z.string().min(2), licenceNumber: z.string().min(2), licenceState: z.string().length(2) })).max(4).optional() }),
    rentalUse: z.enum(['PERSONAL', 'COMMERCIAL', 'RIDESHARE_OR_DELIVERY']).default('PERSONAL'), vehicle: vehicleSchema,
  }),
  coverages: z.array(z.enum(RENTAL_COVERAGE_CODES)).min(1),
  packageCode: z.enum(RENTAL_PROTECTION_PACKAGE_CODES).optional(),
});

export const rentalPricePreviewBodySchema = z.object({
  pickup: z.object({ country: z.literal('US'), state: z.string().length(2) }),
  rentalStart: z.string().datetime({ offset: true }), rentalEnd: z.string().datetime({ offset: true }),
  vehicle: vehicleSchema,
  coverages: z.array(z.enum(RENTAL_COVERAGE_CODES)).min(1),
});

export const quoteParamsSchema = z.object({ quoteId: z.string().min(1) });
export const policyParamsSchema = z.object({ policyId: z.string().min(1) });
export const policyDocumentParamsSchema = z.object({ policyId: z.string().min(1), coverage: z.enum(RENTAL_COVERAGE_CODES) });
export const rentalBindBodySchema = z.object({
  integrityToken: z.string().min(16),
  payment: z.object({ provider: z.enum(['SIMULATED', 'HOSTED']), token: z.string().min(12) }),
  expectedTotal: z.number().nonnegative().optional(),
  policyholder: z.object({
    firstName: z.string().min(1), lastName: z.string().min(1), dateOfBirth: z.string().date(), email: z.string().email(), phone: z.string().min(7),
    address: z.object({ line1: z.string().min(1), line2: z.string().optional(), city: z.string().min(1), state: z.string().length(2), postalCode: z.string().min(5), country: z.literal('US') }),
    licence: z.object({ number: z.string().min(2), state: z.string().length(2) }),
  }),
  rentalAgreement: z.object({ rentalCompany: z.string().min(1), agencyEmail: z.string().email().optional() }),
  inspectionRecipient: z.enum(['Renter', 'Rental Agency']).optional(),
  alternateEmail: z.union([z.string().email(), z.literal('')]).optional(),
  policyBookingTimeZone: z.string().min(1).optional(),
  additionalDrivers: z.array(z.object({
    firstName: z.string().min(1), lastName: z.string().min(1), email: z.string().email(),
    dateOfBirth: z.string().date(), phone: z.string().regex(/^\d{11}$/),
  }).strict()).max(4).optional(),
  rmsMetadata: z.object({
    reservationId: z.string().optional(), reservationCreatedAt: z.string().datetime({ offset: true }).optional(),
    vehicleId: z.string().optional(), vin: z.string().optional(), mileageOut: z.number().nonnegative().optional(),
    mileageIn: z.number().nonnegative().optional(), licensePlate: z.string().optional(), licenseState: z.string().optional(),
    rentalContractReference: z.string().optional(), purchasePaidAt: z.string().datetime({ offset: true }).optional(),
  }).strict().optional(),
  consents: z.object({
    electronicDelivery: z.literal(true), termsAndPrivacyAccepted: z.literal(true), exclusionsAccepted: z.literal(true), truthfulnessAccepted: z.literal(true),
    liabilityNoticeAccepted: z.boolean(), wordingVersion: z.string().min(1), acceptedAt: z.string().datetime({ offset: true }),
  }),
});
