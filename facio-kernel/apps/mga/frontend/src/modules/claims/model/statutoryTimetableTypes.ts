export type StatutoryDeadlineStatus = 'NOT_STARTED' | 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE';

export type StatutoryDeadlineItem = {
  key:
    | 'FIRST_CONTACT'
    | 'INSPECTION_COMPLETION'
    | 'INSPECTION_REPORT'
    | 'LIABILITY_DECISION'
    | 'PAYMENT'
    | 'COMPLAINT_RESPONSE';
  label: string;
  articles?: string[];
  dueDate: string | null;
  status: StatutoryDeadlineStatus;
  basis: string;
};

export type StatutoryTimetable = {
  regulatoryReference: string;
  anchorDate: string;
  daaaSigned: boolean;
  dismantlingRequired: boolean;
  items: StatutoryDeadlineItem[];
};

export type ClaimStatutoryTimetableResult =
  | {
      applicable: false;
      reason: 'no_product' | 'jurisdiction_unresolved' | 'no_statutory_timetable';
      countryCode?: string;
      productCode?: string;
    }
  | {
      applicable: true;
      anchored: false;
      regulatoryReference: string;
      countryCode: string;
      productCode: string;
    }
  | {
      applicable: true;
      anchored: true;
      countryCode: string;
      productCode: string;
      timetable: StatutoryTimetable;
    };
