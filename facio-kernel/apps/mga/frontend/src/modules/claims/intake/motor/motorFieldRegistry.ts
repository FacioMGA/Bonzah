import type { ProductIntakeUI } from '../model/types';
import {
  isPoliceReportRequired,
  isThirdPartyNameRequired,
  isThirdPartySectionVisible,
  isWindscreenSectionVisible,
  MOTOR_LOSS_TYPE_OPTIONS,
  YES_NO_OPTIONS,
} from './motorRenderRules';

export const motorFieldRegistry: ProductIntakeUI = {
  productCode: 'MOTOR',
  sections: [
    {
      id: 'incident',
      title: 'Incident',
      description: 'Core loss facts required for FNOL confirmation.',
      fields: [
        {
          path: 'incident.type',
          label: 'Loss type',
          type: 'select',
          options: [...MOTOR_LOSS_TYPE_OPTIONS],
        },
        { path: 'incident.date', label: 'Date of loss', type: 'date' },
        { path: 'incident.location.address', label: 'Location', type: 'text', placeholder: 'City / country' },
        { path: 'incident.description', label: 'Incident description', type: 'textarea' },
        {
          path: 'thirdParty.involved',
          label: 'Third party involved',
          type: 'select',
          options: [...YES_NO_OPTIONS],
          visibleWhen: isThirdPartySectionVisible,
        },
      ],
    },
    {
      id: 'thirdParty',
      title: 'Third Party',
      description: 'Only required when third-party involvement is declared.',
      fields: [
        {
          path: 'thirdParty.name',
          label: 'Third-party name',
          type: 'text',
          visibleWhen: isThirdPartySectionVisible,
          requiredWhen: isThirdPartyNameRequired,
        },
        {
          path: 'thirdParty.registration',
          label: 'Third-party registration',
          type: 'text',
          visibleWhen: isThirdPartySectionVisible,
        },
      ],
    },
    {
      id: 'theft',
      title: 'Theft Details',
      fields: [
        {
          path: 'police.reportNumber',
          label: 'Police report number',
          type: 'text',
          visibleWhen: isPoliceReportRequired,
          requiredWhen: isPoliceReportRequired,
        },
      ],
    },
    {
      id: 'windscreen',
      title: 'Windscreen',
      fields: [
        {
          path: 'windscreen.glassDamageArea',
          label: 'Damaged glass area',
          type: 'text',
          visibleWhen: isWindscreenSectionVisible,
          requiredWhen: isWindscreenSectionVisible,
        },
      ],
    },
  ],
};
