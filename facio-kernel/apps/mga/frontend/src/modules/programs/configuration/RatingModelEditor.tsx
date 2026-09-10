import React from 'react';
import type { JsonObject } from '@/src/modules/programs/components/StructuredJsonEditor';
import { StructuredJsonEditor } from '@/src/modules/programs/components/StructuredJsonEditor';
import { MotorRatingModelEditor } from '@/src/products/motor/configuration/MotorRatingModelEditor';
import { HealthRatingModelEditor } from '@/src/products/health/configuration/HealthRatingModelEditor';
import { HomeRatingModelEditor } from '@/src/products/home/configuration/HomeRatingModelEditor';
import { TravelRatingModelEditor } from '@/src/products/travel/configuration/TravelRatingModelEditor';
import type { PricingStage } from '@/src/modules/programs/model/programs';

type Props = {
  productType?: string;
  value: JsonObject;
  onChange: (next: JsonObject) => void;
  stages: PricingStage[];
  onStagesChange: (next: PricingStage[]) => void;
  ratingPipeline?: Array<{ operator: string; label: string }>;
};

/** Presentation registry: product-owned editors without programme values in the BO surface. */
export function RatingModelEditor({ productType, value, onChange, stages, onStagesChange, ratingPipeline }: Props) {
  if (String(productType || '').trim().toUpperCase() === 'MOTOR') {
    return <MotorRatingModelEditor tables={value} onChange={onChange} stages={stages} onStagesChange={onStagesChange} ratingPipeline={ratingPipeline} />;
  }
  if (String(productType || '').trim().toUpperCase() === 'HEALTH') {
    return <HealthRatingModelEditor tables={value} onChange={onChange} />;
  }
  if (String(productType || '').trim().toUpperCase() === 'HOME') {
    return <HomeRatingModelEditor tables={value} onChange={onChange} />;
  }
  if (String(productType || '').trim().toUpperCase() === 'TRAVEL') {
    return <TravelRatingModelEditor tables={value} onChange={onChange} />;
  }
  return <StructuredJsonEditor label="Rating-model tables" description="The complete product-owned executable rating data. No file or previous model is used at runtime." value={value} onChange={(next) => {
    if (next && typeof next === 'object' && !Array.isArray(next)) onChange(next);
  }} />;
}
