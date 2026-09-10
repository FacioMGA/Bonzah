import React from 'react';
import { StructuredJsonEditor, type JsonObject } from '@/src/modules/programs/components/StructuredJsonEditor';
import { MotorUnderwritingEditor } from '@/src/products/motor/configuration/MotorUnderwritingEditor';
import { ProgrammeChannelsEditor } from './ProgrammeChannelsEditor';
import { ProgrammeCoverageEditor } from './ProgrammeCoverageEditor';
import { ProgrammeDocumentsEditor } from './ProgrammeDocumentsEditor';
import { ProgrammeQuestionnaireEditor } from './ProgrammeQuestionnaireEditor';
import { ProgrammeWorkflowEditor } from './ProgrammeWorkflowEditor';
import { HomeUnderwritingEditor } from '@/src/products/home/configuration/HomeUnderwritingEditor';
import { TravelUnderwritingEditor } from '@/src/products/travel/configuration/TravelUnderwritingEditor';
import { HealthUnderwritingEditor } from '@/src/products/health/configuration/HealthUnderwritingEditor';

export type ProgrammeDefinitionEditorControl = 'structured' | 'coverage' | 'questionnaire' | 'workflow' | 'channels' | 'documents' | 'home-underwriting' | 'travel-underwriting' | 'health-underwriting' | 'motor-underwriting';

type Props = {
  control: ProgrammeDefinitionEditorControl;
  label: string;
  description: string;
  productType: string;
  pricingMode: '' | 'AUTOMATED' | 'MANUAL';
  value: JsonObject;
  onChange: (next: JsonObject) => void;
};

/**
 * BO projection of the product-owned descriptor. This never owns programme
 * values: it selects only the editor declared by the canonical runtime.
 */
export function ProgrammeDefinitionComponentEditor({ control, label, description, productType, pricingMode, value, onChange }: Props) {
  if (control === 'motor-underwriting') {
    return <MotorUnderwritingEditor value={value} onChange={onChange} />;
  }
  if (control === 'home-underwriting') return <HomeUnderwritingEditor value={value} onChange={onChange} />;
  if (control === 'travel-underwriting') return <TravelUnderwritingEditor value={value} onChange={onChange} />;
  if (control === 'health-underwriting') return <HealthUnderwritingEditor value={value} onChange={onChange} />;
  if (control === 'coverage') return <ProgrammeCoverageEditor pricingMode={pricingMode} value={value} onChange={onChange} />;
  if (control === 'questionnaire') return <ProgrammeQuestionnaireEditor value={value} onChange={onChange} />;
  if (control === 'workflow') return <ProgrammeWorkflowEditor value={value} onChange={onChange} />;
  if (control === 'channels') return <ProgrammeChannelsEditor value={value} onChange={onChange} />;
  if (control === 'documents') return <ProgrammeDocumentsEditor productType={productType} value={value} onChange={onChange} />;
  return <StructuredJsonEditor label={label} description={description} value={value} onChange={(next) => {
    if (next && typeof next === 'object' && !Array.isArray(next)) onChange(next);
  }} />;
}
