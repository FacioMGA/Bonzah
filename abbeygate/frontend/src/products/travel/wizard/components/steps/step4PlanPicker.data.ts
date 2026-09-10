export type PlanId = 'silver' | 'gold' | 'platinum';

export interface BenefitItem {
  /** Unique key for React reconciliation and collapse state. */
  id: string;
  label: string;
  /** Optional qualifying note shown beneath the amount (age/limit caveats). */
  sublabel?: string;
  /** Expanded description shown when the user clicks "view details". */
  detail: string;
  amounts: Record<PlanId, string>;
}

export interface BenefitSection {
  id: string;
  title: string;
  items: BenefitItem[];
}

// ---------------------------------------------------------------------------
// View-detail descriptions (verbatim from Lloyd's approved wording)
// ---------------------------------------------------------------------------

const EXCESS_DETAIL =
  "The amount of money you'll have to pay per person, per claim. The excess you pay is dependent on the cover level.";

const CANCELLATION_DETAIL =
  'Covers costs that you have paid which cannot be recovered from any other source, if you have to cancel or cut short your journey for one of the reasons listed in the policy, up to amount shown in your Schedule of insurance. The Policy wording shows full details.';

const TRAVEL_DISRUPTION_DETAIL =
  'A contribution to the costs of completing the outward part of a disrupted journey. Full details in policy';

const ALT_ACCOM_DETAIL =
  'A contribution towards the cost of new accommodation when your booked accommodation is uninhabitable. Full details in policy wording';

const MISSED_DEPARTURE_DETAIL =
  'A sum for additional travel and accommodation costs if you are delayed getting to the airport and miss your flight or your aircraft is diverted. Specific reasons for the delay in the policy wording';

const TRAVEL_DELAY_DETAIL =
  'A sum of money if your flight is delayed for 12 hours or more. Full details in policy wording';

const ALTERATION_DETAIL =
  'A sum for additional costs if you have to change your trip arrangements because you have been kidnapped, hijacked or been victim of terrorist activity. Full details in the policy wording';

const EMERGENCY_MEDICAL_DETAIL =
  'Covers the costs of emergency medical treatment during your trip and repatriation to your country of residence if needed, up to the amount shown in your Schedule of insurance. The Policy wording shows full details.';

const HOSPITAL_DETAIL =
  'A small cash sum for every full 24 hours you spend in hospital as an inpatient. Full details in the policy wording';

const FUNERAL_DETAIL =
  'The costs of burying or cremating or repatriation of the body of an insured person who dies during a trip. Full details in the policy wording';

const PET_CARE_DETAIL =
  'Additional kennel/cattery costs if you are delayed returning home because of death or illness. Full details in the policy wording';

const PERSONAL_ACCIDENT_DETAIL =
  'A lump sum payment, as specified in the policy wording, if, as a result of an accident, you die, or suffer permanent disablement. The Policy wording shows full details.';

const ACCIDENTAL_DEATH_DETAIL =
  'A lump sum benefit payable if you suffer an injury during a trip which results in you dying. Full details in the policy wording';

const LOSS_ONE_LIMB_DETAIL =
  'A lump sum benefit payable if you suffer an injury during a trip which results in you losing or losing the use of either one limb or one eye. Full details in the policy wording';

const LOSS_TWO_LIMBS_DETAIL =
  'A lump sum benefit payable if you suffer an injury during a trip which results in you losing or using the use of either two limbs or two eyes or one limb and one eye. Full details in the policy wording';

const PERMANENT_DISABLEMENT_DETAIL =
  'A lump sum benefit payable if you suffer an injury during a trip which prevents you from carrying on any suitable occupation for the rest of your life. Full details in the policy wording';

const BAGGAGE_DETAIL =
  'Covers the loss, damage or theft of your baggage and personal effects, up to the amount shown in your Schedule of Insurance. The Policy Wording shows full details.';

const SINGLE_ITEM_DETAIL =
  'The maximum amount that is covered for any single item of belongings if you make a valid claim under the Baggage Section of the policy. Full details in the policy wording';

const VALUABLES_DETAIL =
  'The total amount that is covered for all valuables which make up part of a valid claim under the Baggage Section of the policy. Full details in the policy wording';

const DELAYED_BAGGAGE_DETAIL =
  'A sum to cover immediate necessities when you arrive at your destination on your outward journey if your baggage is delayed for more than 12 hours. Full details in the policy wording';

const CASH_ADULT_DETAIL =
  'The maximum amount you can claim for the loss of money including coins bank notes and pre-loaded debit or credit cards. Full details in the policy wording';

const CASH_MINOR_DETAIL =
  'The maximum amount you can claim for the loss of money including coins bank notes and pre-loaded debit or credit cards. Full details in the policy wording';

const FRAUD_CARD_DETAIL =
  'Covers a loss resulting from the fraudulent use of any personal credit card, debit card, or charge card following the loss of the card during the trip up to the amount shown in your Schedule of Insurance. The Policy Wording shows full details.';

const PERSONAL_LIABILITY_DETAIL =
  'Cover for the costs of damages you are legally responsible to pay to another person, because you have caused them personal injury or damaged their property. Full details in the policy wording';

const HIJACK_DETAIL =
  'A daily payment, for every 24 hours that you are hijacked or kidnapped up to the amount shown in your Schedule of Insurance. The Policy Wording shows full details.';

// ---------------------------------------------------------------------------
// Standalone item shown before sections (not inside any group)
// ---------------------------------------------------------------------------

export const STANDARD_EXCESS_ITEM: BenefitItem = {
  id: 'excess',
  label: 'Standard excess',
  detail: EXCESS_DETAIL,
  amounts: { silver: '€100', gold: '€100', platinum: '€100' },
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const BENEFIT_SECTIONS: BenefitSection[] = [
  {
    id: 'cancellation',
    title: 'Cancellation, Curtailment and Related Benefits',
    items: [
      {
        id: 'cancellation',
        label: 'Cancellation or Curtailment',
        detail: CANCELLATION_DETAIL,
        amounts: { silver: '€1,000', gold: '€5,000', platinum: '€10,000' },
      },
      {
        id: 'travel-disruption',
        label: 'Travel Disruption',
        detail: TRAVEL_DISRUPTION_DETAIL,
        amounts: { silver: '€250', gold: '€500', platinum: '€750' },
      },
      {
        id: 'alt-accom',
        label: 'Alternative Accommodation',
        detail: ALT_ACCOM_DETAIL,
        amounts: { silver: '€250', gold: '€500', platinum: '€750' },
      },
      {
        id: 'missed-departure',
        label: 'Missed Departure and Transport Diversion',
        detail: MISSED_DEPARTURE_DETAIL,
        amounts: { silver: '€250', gold: '€500', platinum: '€750' },
      },
      {
        id: 'travel-delay',
        label: 'Travel Delay Inconvenience Benefit',
        detail: TRAVEL_DELAY_DETAIL,
        amounts: { silver: '10 per day up to €100', gold: '20 per day up to €200', platinum: '30 per day up to €300' },
      },
      {
        id: 'alteration',
        label: 'Alteration of Itinerary',
        detail: ALTERATION_DETAIL,
        amounts: { silver: '€250', gold: '€500', platinum: '€750' },
      },
    ],
  },
  {
    id: 'medical',
    title: 'Emergency Medical and Repatriation',
    items: [
      {
        id: 'emergency-medical',
        label: 'Emergency Medical and Repatriation Expenses',
        detail: EMERGENCY_MEDICAL_DETAIL,
        amounts: { silver: '€1,000,000', gold: '€3,500,000', platinum: '€5,000,000' },
      },
      {
        id: 'hospital',
        label: 'Hospital Inconvenience Expenses',
        detail: HOSPITAL_DETAIL,
        amounts: { silver: '10 per day up to €300', gold: '20 per day up to €600', platinum: '30 per day up to €900' },
      },
      {
        id: 'funeral',
        label: 'Funeral Expenses',
        detail: FUNERAL_DETAIL,
        amounts: { silver: '€1,500', gold: '€3,500', platinum: '€5,000' },
      },
      {
        id: 'pet-care',
        label: 'Pet Care (Additional Kennel/Cattery)',
        detail: PET_CARE_DETAIL,
        amounts: { silver: '50 per day up to €500', gold: '50 per day up to €500', platinum: '50 per day up to €500' },
      },
    ],
  },
  {
    id: 'personal-accident',
    title: 'Personal Accident',
    items: [
      {
        id: 'pa',
        label: 'Personal Accident',
        detail: PERSONAL_ACCIDENT_DETAIL,
        amounts: { silver: '€10,000', gold: '€15,000', platinum: '€50,000' },
      },
      {
        id: 'accidental-death',
        label: 'Accidental Death',
        sublabel: 'Under 16 limit €2,500 · Over 65 limit €5,000',
        detail: ACCIDENTAL_DEATH_DETAIL,
        amounts: { silver: '€10,000', gold: '€15,000', platinum: '€50,000' },
      },
      {
        id: 'loss-one-limb',
        label: 'Loss of one limb or one eye',
        sublabel: 'Under 16 or over 65 limited to 50%',
        detail: LOSS_ONE_LIMB_DETAIL,
        amounts: { silver: '€10,000', gold: '€15,000', platinum: '€50,000' },
      },
      {
        id: 'loss-two-limbs',
        label: 'Loss of two limbs or both eyes or one limb and one eye',
        sublabel: 'Under 16 or over 65 limited to 50%',
        detail: LOSS_TWO_LIMBS_DETAIL,
        amounts: { silver: '€10,000', gold: '€15,000', platinum: '€50,000' },
      },
      {
        id: 'permanent-disablement',
        label: 'Permanent Total Disablement',
        sublabel: 'Under 16 limited to 50% of benefit. Over 65 no cover.',
        detail: PERMANENT_DISABLEMENT_DETAIL,
        amounts: { silver: '€10,000', gold: '€15,000', platinum: '€50,000' },
      },
    ],
  },
  {
    id: 'baggage',
    title: 'Baggage and Personal Effects and Related Benefits',
    items: [
      {
        id: 'baggage',
        label: 'Baggage and Personal Effects',
        detail: BAGGAGE_DETAIL,
        amounts: { silver: '€750', gold: '€5,000', platinum: '€7,500' },
      },
      {
        id: 'single-item',
        label: 'Single Item Pair or Set Limit',
        detail: SINGLE_ITEM_DETAIL,
        amounts: { silver: '€150', gold: '€300', platinum: '€450' },
      },
      {
        id: 'valuables',
        label: 'Valuables Total Limit',
        detail: VALUABLES_DETAIL,
        amounts: { silver: '€150', gold: '€300', platinum: '€450' },
      },
      {
        id: 'delayed-baggage',
        label: 'Delayed Baggage',
        detail: DELAYED_BAGGAGE_DETAIL,
        amounts: { silver: '€150', gold: '€300', platinum: '€450' },
      },
      {
        id: 'cash-adult',
        label: 'Cash Limit (aged 18 and above)',
        detail: CASH_ADULT_DETAIL,
        amounts: { silver: '€150', gold: '€300', platinum: '€450' },
      },
      {
        id: 'cash-minor',
        label: 'Cash Limit (under 18)',
        detail: CASH_MINOR_DETAIL,
        amounts: { silver: '€100', gold: '€150', platinum: '€225' },
      },
      {
        id: 'fraud-card',
        label: 'Fraudulent Use of Lost Credit / Debit Card',
        detail: FRAUD_CARD_DETAIL,
        amounts: { silver: '€150', gold: '€300', platinum: '€450' },
      },
    ],
  },
  {
    id: 'liability',
    title: 'Personal Liability and Other',
    items: [
      {
        id: 'personal-liability',
        label: 'Personal Liability',
        detail: PERSONAL_LIABILITY_DETAIL,
        amounts: { silver: '€1,000,000', gold: '€1,500,000', platinum: '€2,000,000' },
      },
      {
        id: 'hijack',
        label: 'Hijack and Kidnap',
        detail: HIJACK_DETAIL,
        amounts: {
          silver: '50 per day up to €1,000',
          gold: '75 per day up to €1,500',
          platinum: '100 per day up to €2,000',
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Document links shown under each plan header
// ---------------------------------------------------------------------------

export const PLAN_DOCUMENTS: { label: string; href: string }[] = [
  { label: 'Insurance Product Information (IPID)', href: '/api/public/ipid/travel' },
  { label: 'Terms of Business', href: '#' },
  { label: 'Policy Wording', href: '#' },
];
