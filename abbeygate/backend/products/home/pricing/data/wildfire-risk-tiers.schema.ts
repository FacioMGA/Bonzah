import { z } from 'zod';

export const WILDFIRE_TIERS = ['red', 'amber', 'yellow', 'green'] as const;
export type WildfireTier = (typeof WILDFIRE_TIERS)[number];
export type WildfireClassificationTier = WildfireTier | 'unclassified';

const WildfireTierEntrySchema = z.object({
  label: z.string().min(1),
  names: z.array(z.string().min(1)),
  keywords: z.array(z.string().min(1)),
});

const CountryWildfireTiersSchema = z.object({
  red: z.array(WildfireTierEntrySchema),
  amber: z.array(WildfireTierEntrySchema),
  yellow: z.array(WildfireTierEntrySchema),
  green: z.array(WildfireTierEntrySchema),
});

export const WildfireRiskTiersSchema = z.object({
  source: z.string().min(1),
  tiers: z.record(z.string().length(2), CountryWildfireTiersSchema),
});

export type WildfireTierEntry = z.infer<typeof WildfireTierEntrySchema>;
export type CountryWildfireTiers = z.infer<typeof CountryWildfireTiersSchema>;
export type WildfireRiskTiers = z.infer<typeof WildfireRiskTiersSchema>;
