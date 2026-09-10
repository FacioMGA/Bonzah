export type IntakeFieldType = 'text' | 'textarea' | 'date' | 'select';

export type IntakeFieldOption = {
  value: string;
  label: string;
};

export type IntakeFieldDef = {
  path: string;
  label: string;
  type: IntakeFieldType;
  options?: IntakeFieldOption[];
  placeholder?: string;
  visibleWhen?: (snapshot: Record<string, unknown>) => boolean;
  requiredWhen?: (snapshot: Record<string, unknown>) => boolean;
};

export type IntakeSectionDef = {
  id: string;
  title: string;
  description?: string;
  fields: IntakeFieldDef[];
};

export type ProductIntakeUI = {
  productCode: string;
  sections: IntakeSectionDef[];
};
