import { z } from 'zod';

export const Step3Schema = z
  .object({
    vehicleLocation: z.string().trim().min(1, 'Please select where the vehicle is kept'),
    countryOfRegistration: z.string().trim().min(1, 'Please select country of registration'),
    registrationNumber: z.string().optional().default(''),
    vin: z.string().optional().default(''),
    coverRequired: z.string().min(1, 'Please select cover type'),
    renewalDate: z.string().min(1, 'Please enter your renewal date'),
    vehicleType: z.string().min(1, 'Please select vehicle type'),
    motorcycleRidersNamed: z.boolean().nullable().optional(),
    classicIsGenuine: z.boolean().nullable().optional(),
    classicIsSecondaryVehicle: z.boolean().nullable().optional(),

    make: z.string().min(1, 'Please select vehicle make'),
    model: z.string().min(1, 'Please select vehicle model'),
    cabrio: z.string().min(1, 'Please indicate if vehicle is a cabrio'),
    parking: z.string().min(1, 'Please select parking location'),
    parkingOther: z.string().optional().default(''),
    fuelType: z.string().min(1, 'Please select fuel type'),
    // `kmsPerYear` is a formatted string in the wizard UX (`'10,000'`)
    // and is parsed downstream by `canonicalRules.ts`. Keeping it as a
    // string-or-number union here is intentional and is the only number-like
    // wizard field that is not coerced numeric — see `Step3VehicleCover.tsx`.
    kmsPerYear: z.union([z.string(), z.number()]),
    year: z.number(),
    numberOfSeats: z.number(),
    modified: z.boolean().nullable(),
    modificationsDetails: z.string().optional().default(''),
    engineSize: z.number(),
    /**
     * Battery capacity in kWh for EVs. Per ADR-0016 (closed by PR 4 of
     * the stale-code-removal program), this is the canonical EV capacity
     * field. Required when `fuelType === 'Electric'`; must be absent /
     * null for ICE rows. Replaces the deleted ADR-0012 `engineSize === 1`
     * transitional sentinel.
     *
     * Allowed range: 5–400 kWh (below 5 kWh suggests a hybrid/PHEV
     * mis-classification; above 400 kWh is out-of-fleet).
     */
    batteryKWh: z.number().min(5).max(400).nullable().optional(),
    vehicleValue: z.number(),
    ncb: z.string().min(1, 'Please select your No Claims Bonus'),
    vehicleUse: z.string().min(1, 'Please select vehicle use'),
    requiredExcess: z.string().optional().default(''),
    ncdProofUpload: z.string().optional().default(''),
    /**
     * Phase 6k canonical shape: `bestTimeToCall` lives under
     * `proposer.*` alongside the rest of the policyholder details.
     * Per-step Zod runs against the full RHF payload, so we accept
     * the proposer object loosely and project the field via
     * `superRefine` for the required-string check below.
     */
    proposer: z.object({
      bestTimeToCall: z.string().optional().default(''),
    }).passthrough().optional(),
    infoTrueAndAccurate: z.boolean(),
    fairProcessingAccepted: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const bestTimeToCall = String(data.proposer?.bestTimeToCall || '').trim();
    if (!bestTimeToCall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposer', 'bestTimeToCall'],
        message: 'Please select the best time to call',
      });
    }

    const normalizedVehicleLocation = String(data.vehicleLocation || '').trim().toLowerCase();
    const normalizedCountryOfRegistration = String(data.countryOfRegistration || '').trim().toLowerCase();
    const allowedVehicleKeptIn = new Set(['cyprus', 'spain', 'portugal', 'greece']);
    const allowedCountryOfRegistration = new Set(['uk', 'spain', 'portugal', 'cyprus', 'greece', 'israel', 'channel islands', 'gibraltar']);

    if (!allowedVehicleKeptIn.has(normalizedVehicleLocation)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicleLocation'],
        message: 'Please select a valid country where the vehicle is kept',
      });
    }
    if (!allowedCountryOfRegistration.has(normalizedCountryOfRegistration)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['countryOfRegistration'],
        message: 'Please select a valid country of registration',
      });
    }

    const reg = String(data.registrationNumber || '').trim();
    const vin = String(data.vin || '').trim().toUpperCase();
    if (reg && reg.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registrationNumber'],
        message: 'Registration number looks too short',
      });
    }

    if (vin) {
      const vinPattern = /^[A-HJ-NPR-Z0-9]{11,17}$/;
      if (!vinPattern.test(vin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['vin'],
          message: 'VIN must be 11-17 characters and cannot contain I, O, or Q',
        });
      }
    }

    const renewalDate = new Date(data.renewalDate);
    if (Number.isNaN(renewalDate.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['renewalDate'], message: 'Please enter your renewal date' });
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const maxDate = new Date(today);
      maxDate.setDate(maxDate.getDate() + 45);

      if (renewalDate < today) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['renewalDate'], message: 'Renewal date must be today or later' });
      } else if (renewalDate > maxDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['renewalDate'],
          message: 'Renewal date must be within the next 45 days',
        });
      }
    }

    const vt = String(data.vehicleType || '').toLowerCase();
    const isMotorcycle = vt.includes('motorbike') || vt.includes('motorcycle');

    // ABY-321 — a motorbike is never a cabriolet; the field is hidden in
    // the wizard and force-set to 'No'. Reject a 'Yes' defensively so a
    // crafted payload can't slip a nonsensical cabriolet motorbike past
    // the canonical validator.
    if (isMotorcycle && String(data.cabrio || '').trim().toLowerCase() === 'yes') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cabrio'],
        message: 'A motorbike cannot be a cabriolet',
      });
    }

    const isClassic = vt.includes('classic');
    if (isClassic) {
      if (data.classicIsGenuine === null || data.classicIsGenuine === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['classicIsGenuine'],
          message: 'Please confirm if this is a genuine classic',
        });
      }
      if (data.classicIsSecondaryVehicle === null || data.classicIsSecondaryVehicle === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['classicIsSecondaryVehicle'],
          message: 'Please confirm if this is a secondary vehicle',
        });
      }
    }

    if (data.parking === 'Other' && (!data.parkingOther || data.parkingOther.trim().length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parkingOther'],
        message: 'Please specify parking location',
      });
    }

    const kmsRaw = data.kmsPerYear;
    const kmsNumber = typeof kmsRaw === 'number'
      ? kmsRaw
      : Number(String(kmsRaw ?? '').replace(/[^0-9]/g, ''));
    if (!Number.isFinite(kmsNumber) || kmsNumber < 1000 || kmsNumber > 50000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kmsPerYear'],
        message: 'Please enter annual kilometres between 1,000 and 50,000',
      });
    }

    const currentYear = new Date().getFullYear();
    if (!data.year || data.year < 1980 || data.year > currentYear) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['year'],
        message: `Please enter a valid year between 1980 and ${currentYear}`,
      });
    }

    // ABY-336 — a motorbike has at most 2 seats (rider + pillion). For all
    // other vehicle types the existing 1-9 range stands.
    const maxSeats = isMotorcycle ? 2 : 9;
    if (!data.numberOfSeats || data.numberOfSeats < 1 || data.numberOfSeats > maxSeats) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['numberOfSeats'],
        message: isMotorcycle
          ? 'A motorbike has at most 2 seats (rider + pillion)'
          : 'Please enter number of seats (1-9)',
      });
    }

    if (data.modified === null || data.modified === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modified'], message: 'Please indicate if vehicle is modified' });
    } else if (data.modified && (!data.modificationsDetails || data.modificationsDetails.trim().length < 10)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modificationsDetails'],
        message: 'Please describe the modifications',
      });
    }

    // Electric vehicles do not have a combustion-engine displacement.
    // Per ADR-0016 (closed by PR 4 of the stale-code-removal program),
    // the canonical EV capacity field is `batteryKWh`. EV rows must
    // declare a `batteryKWh` value in the 5–400 kWh range; ICE rows
    // must declare `engineSize` in the 300–6000 cc range and MUST NOT
    // carry a `batteryKWh` value. The legacy `engineSize === 1`
    // sentinel from ADR-0012 has been deleted.
    const fuelType = String(data.fuelType || '').trim();
    const isElectric = fuelType === 'Electric';
    const vehicleTypeRaw = String(data.vehicleType || '').trim().toLowerCase();
    const isCaravan =
      vehicleTypeRaw.includes('motorcaravan') ||
      vehicleTypeRaw.includes('motorhome') ||
      vehicleTypeRaw.includes('caravan');
    if (isElectric) {
      if (data.batteryKWh === undefined || data.batteryKWh === null || !Number.isFinite(data.batteryKWh)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['batteryKWh'],
          message: 'Please enter battery capacity (kWh) for the electric vehicle',
        });
      }
    } else if (isCaravan) {
      if (data.engineSize < 0 || data.engineSize > 6000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['engineSize'],
          message: 'Please enter engine size between 0 and 6000 cc',
        });
      }
      if (data.batteryKWh !== undefined && data.batteryKWh !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['batteryKWh'],
          message: 'Battery capacity must only be set for electric vehicles',
        });
      }
    } else if (isMotorcycle) {
      // ABY (WhatsApp): motorbikes routinely have small displacements
      // (mopeds/learner-legal bikes from 50cc, e.g. a 125cc). The default
      // 300cc floor wrongly blocked them. Motorbikes carry their own
      // displacement range distinct from cars.
      if (!data.engineSize || data.engineSize < 50 || data.engineSize > 1500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['engineSize'],
          message: 'Please enter engine size between 50 and 1500 cc',
        });
      }
      if (data.batteryKWh !== undefined && data.batteryKWh !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['batteryKWh'],
          message: 'Battery capacity must only be set for electric vehicles',
        });
      }
    } else {
      if (!data.engineSize || data.engineSize < 300 || data.engineSize > 6000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['engineSize'],
          message: 'Please enter engine size between 300 and 6000 cc',
        });
      }
      if (data.batteryKWh !== undefined && data.batteryKWh !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['batteryKWh'],
          message: 'Battery capacity (kWh) is only valid for electric vehicles',
        });
      }
    }

    if (!data.vehicleValue || data.vehicleValue < 1000 || data.vehicleValue > 200000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicleValue'],
        message: 'Please enter vehicle value between €1,000 and €200,000',
      });
    }

    const isMotorcycleOver200cc = isMotorcycle && data.engineSize > 200;
    if (isMotorcycleOver200cc && data.ncdProofUpload) {
      const name = String(data.ncdProofUpload || '').toLowerCase();
      const valid = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].some((ext) => name.endsWith(ext));
      if (!valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ncdProofUpload'],
          message: 'Upload must be PDF or image (png/jpg/jpeg/webp)',
        });
      }
    }

    if (!data.infoTrueAndAccurate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['infoTrueAndAccurate'],
        message: 'You must confirm that the information provided is true and accurate',
      });
    }
    if (!data.fairProcessingAccepted) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fairProcessingAccepted'],
        message: 'You must accept the fair processing declaration',
      });
    }
  })
  // See step1.ts for the cross-step `.passthrough()` rationale.
  .passthrough();
