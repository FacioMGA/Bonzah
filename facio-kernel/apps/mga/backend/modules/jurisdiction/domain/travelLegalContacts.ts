import type { DocumentJurisdictionConfig, JurisdictionCountryCode, TravelLegalContacts } from './productConfiguration.js';

/**
 * Per-country Travel Service of Suit + complaints data + document
 * presets — sourced verbatim from the BRIT TRAVEL DRAFT SCHEDULE V3
 * docx (Andy 2026-05-16), expanded 2026-05-19 with the per-country
 * schedules supplied by Peter Sheppard (Abbeygate MD) covering the
 * six BRIT-authorised countries that did not have wording in V3.
 * Imported by `productConfiguration.ts` to populate the Travel
 * `documentConfig` block on each `<country>/TRAVEL` CONFIG row.
 *
 * Authoritative legal-contacts coverage: Cyprus, Portugal, Spain,
 * Greece, Belgium, Netherlands, Italy, France, Malta — i.e. every
 * BRIT-authorised Travel country.
 *
 * Lloyd's reference codes (LBS0006A, LBS0081, LBS0038A, LBS0064,
 * LBS0034A) are the standard wording references — DO NOT invent new
 * ones, DO NOT edit the date associated with a reference code. The
 * six countries added on 2026-05-19 all reference `LBS0081 01/12/2019
 * V1124` per Peter's email: the EU travel wording is the standard
 * approved wording, and only the country-specific cover page and
 * schedule data vary per territory. Changes here are Lloyd's-approved
 * wording amendments and require an ADR.
 */

export const TRAVEL_LEGAL_CONTACTS: Partial<Record<JurisdictionCountryCode, TravelLegalContacts>> = {
  CY: {
    governingLaw: 'CYPRUS Law',
    jurisdiction: 'CYPRUS',
    serviceOfSuit: {
      recipients: [
        {
          name: "Lloyd's Cyprus Limited",
          addressLines: ['41-49, Agiou Nicolaou Street, Nimeli Court, Block C, 3rd Floor, 2408 Engomi, Cyprus'],
        },
        {
          name: "Stephen Michaelides — General Representative for Cyprus, Lloyd's Insurance Company S.A.",
          addressLines: ['41-49, Agiou Nicolaou Street, Nimeli Court, Block C, 3rd Floor, 2408 Engomi, Cyprus'],
        },
      ],
      referenceCode: 'LBS0006A',
      referenceDate: '01/12/2019',
    },
    lloydsLocalEntity: {
      name: "Lloyd's Cyprus Limited",
      addressLines: ['41-49, Agiou Nicolaou Street, Nimeli Court, Block C, 3rd Floor, 2408 Engomi, Cyprus'],
    },
    generalRepresentative: {
      name: 'Stephen Michaelides',
      representativeFor: 'Cyprus',
      addressLines: ['41-49, Agiou Nicolaou Street, Nimeli Court, Block C, 3rd Floor, 2408 Engomi, Cyprus'],
    },
    complaints: {
      ombudsmanName: 'Financial Ombudsman of the Republic of Cyprus',
      ombudsmanPostal: 'PO Box 25735\n1311 Nicosia\nCyprus',
      ombudsmanTel: '+357 2284 8900',
      ombudsmanEmail: 'complaints@financialombudsman.gov.cy',
      ombudsmanWebsite: 'www.financialombudsman.gov.cy',
      // Verbatim from BRIT TRAVEL DRAFT SCHEDULE V3 docx (LBS0038A).
      procedureParagraphs: [
        'Your complaint will be acknowledged, in writing, within 2 (two) business days of the complaint being received.',
        'A decision on your complaint will be provided to you, in writing, within 15 (fifteen) business days of the complaint being received. If it is not feasible to make a decision within 15 (fifteen) business days, you will be informed about the reasons for the delay, in writing, before the end of the 15 (fifteen) business day time limit and advise you when it expects to provide you with its decision. The additional time taken by the insurer to provide you with its decision on the complaint will be within 30 (thirty) business days from the end of the original 15 (fifteen) business day time limit.',
        'Should you remain dissatisfied with the final response or if you have not received a final response within 3 (three) months of the complaint being received, you may be eligible to refer your complaint to the Financial Ombudsman of the Republic of Cyprus.',
      ],
      referenceCode: 'LBS0038A',
      referenceDate: '01/02/2019',
    },
  },
  PT: {
    governingLaw: 'PORTUGAL Law',
    jurisdiction: 'PORTUGAL',
    serviceOfSuit: {
      recipients: [
        {
          name: 'Jose Nunez',
          addressLines: [
            "Lloyd's Sucursal em Portugal",
            'c/o Cruz, Menezes & Associados, Sociedade Civil de Advogados, R.L.',
            'Rua Victor Cordon, 10 A, 4º e 5º Pisos, 1249-202 Lisboa, Portugal',
          ],
        },
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
    complaints: {
      ombudsmanName: 'Mr Gonçalo Vareiro (PACC.V, Sociedade de Advogados RL)',
      ombudsmanPostal: 'Rua Braamcamp, n.º 6, 1.º Esq.\n1250-050 Lisbon\nPortugal',
      ombudsmanFax: '+351 213 802 629',
      ombudsmanEmail: 'gvareiro@paccv.com',
      authorityName: 'Authority for the Supervision of Insurance and Pension Funds (ASF)',
      authorityPostal: 'Av. da República, 76\n1600-205 Lisbon\nPortugal',
      authorityTel: '(351) 21 790 31 00',
      authorityFax: '(351) 21 793 85 68',
      // Verbatim from BRIT TRAVEL DRAFT SCHEDULE V3 docx (LBS0064).
      procedureParagraphs: [
        'Your complaint will be acknowledged in writing, within 5 (five) business days of the complaint being made. You will be informed of the date when the investigation is expected to be finished.',
        'A decision on your complaint will be provided to you, in writing, within 20 (twenty) calendar days (or 30 (thirty) calendar days for exceptional or complex cases) of the complaint being received.',
        "Should you remain dissatisfied with the final response or if you have not received a final response within 20 (twenty) calendar days (or 30 (thirty) calendar days for exceptional or complex cases) of the complaint being received, you may refer your complaint to an independent Customers' Ombudsman in accordance with law in Portugal. Insurers providing insurance policies in Portugal must appoint an independent Customers' Ombudsman in Portugal. The Ombudsman will review the complaint within 30 (thirty) calendar days of receipt (or 45 (forty-five) calendar days in exceptional cases) and issue a recommendation accordingly.",
        "Lloyd's Insurance Company S.A. has appointed Mr Gonçalo Vareiro as its Ombudsman in Portugal. You may also bring a complaint before the Authority for the Supervision of Insurance and Pension Funds (ASF).",
      ],
      referenceCode: 'LBS0064',
      referenceDate: '01/01/2019',
    },
  },
  ES: {
    governingLaw: 'SPAIN Law',
    jurisdiction: 'SPAIN',
    serviceOfSuit: {
      recipients: [
        {
          name: 'Jose Nunez',
          addressLines: [
            "Lloyd's Iberia Representative, S.L.U.",
            'C/ Pinar 7, 1º drcha. 28006 Madrid',
          ],
        },
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
    complaints: {
      ombudsmanName: 'Directorate General of Insurance',
      ombudsmanPostal: 'Miguel Ángel, 21\n28010 Madrid\nSpain',
      ombudsmanTel: '952 24 99 82',
      ombudsmanWebsite: 'www.dgsfp.mineco.es/es/Consumidor/ProteccionAsegurado/Paginas/InformacionProcedimiento.aspx',
      authorityName: 'Directorate General of Insurance (Spain)',
      authorityPostal: 'Miguel Ángel, 21\n28010 Madrid\nSpain',
      authorityTel: '952 24 99 82',
      // Verbatim from BRIT TRAVEL DRAFT SCHEDULE V3 docx (LBS0034A — Spain FOS).
      procedureParagraphs: [
        'Your complaint will be acknowledged, in writing, within 5 (five) business days of the complaint being made.',
        'A decision on your complaint will be provided to you, in writing, within 2 (two) months of the complaint being made.',
        'Should you remain dissatisfied with the final response or if you have not received a final response within 2 (two) months of the complaint being made, you may voluntarily submit a dispute to arbitration in accordance with the terms of the Spanish Law for the Protection of Consumers and Users and related subordinate legislation, without prejudice to the provisions of the Arbitration Law in the event that the parties submit any dispute to the decision of one or more arbitrators.',
        'You may be eligible to refer your complaint to the Directorate General of Insurance in Spain. You may also bring a legal action before the Court of first instance corresponding to your domicile under Section 24 of the Insurance Contracts Act.',
      ],
      referenceCode: 'LBS0034A',
      referenceDate: '01/02/2019',
    },
  },
  // Added 2026-05-19 from Peter Sheppard's email. All six countries
  // use the standard EU travel wording (LBS0081 01/12/2019 V1124);
  // only the cover-page / schedule data changes per territory.

  GR: {
    governingLaw: 'GREECE Law',
    jurisdiction: 'GREECE',
    serviceOfSuit: {
      recipients: [
        {
          name: "General Representative for Greece, Lloyd's Insurance Company S.A.",
          addressLines: [
            'c/o Grant Thornton Greece',
            '58, Katehaki Ave.',
            '115 25 Athens',
            'Greece',
          ],
        },
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
    complaints: {
      ombudsmanName: 'Hellenic Consumers Ombudsman',
      ombudsmanPostal: '144 Alexandras Avenue\n114 71 Athens\nGreece',
      ombudsmanTel: '+30 210 646 0862',
      ombudsmanFax: '+30 210 646 0414',
      ombudsmanEmail: 'grammateia@synigoroskatanaloti.gr',
      authorityName: 'Bank of Greece',
      authorityPostal: '21 E. Venizelos Avenue\n102 50 Athens\nGreece',
      authorityTel: '+30 210 320 1111',
      procedureParagraphs: [
        'Your complaint will be acknowledged, in writing, within 5 (five) business days of the complaint being received.',
        'A final response to your complaint will be provided to you, in writing, within 50 (fifty) calendar days of the complaint being received.',
        "Should you remain dissatisfied with the final response, or if you have not received a final response within 50 (fifty) calendar days of the complaint being received, you may refer your complaint to the Hellenic Consumers Ombudsman, the Bank of Greece (Insurance Complaints, insurancecomplaints@bankofgreece.gr) or the General Secretariat for Trade and Consumer Protection (Ministry of Development and Investments, Directorate General for Consumer Protection, Kaniggos Sq., 10181 Athens, Greece, Tel: 210 3332000, Email: 1520@mindev.gov.gr).",
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
  },

  BE: {
    governingLaw: 'BELGIUM Law',
    jurisdiction: 'BELGIUM',
    serviceOfSuit: {
      recipients: [
        {
          name: "Lloyd's Insurance Company S.A.",
          addressLines: [
            'Bastion Tower',
            'Marsveldplein 5',
            '1050 Brussels',
            'Belgium',
          ],
        },
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
    complaints: {
      ombudsmanName: 'Insurance Ombudsman',
      ombudsmanPostal: 'Square de Meeûs 35\n1000 Brussels\nBelgium',
      ombudsmanTel: '+32 (0) 2 547 58 71',
      ombudsmanFax: '+32 (0) 2 547 59 75',
      ombudsmanEmail: 'info@ombudsman-insurance.be',
      authorityName: 'National Bank of Belgium / FSMA',
      procedureParagraphs: [
        'Your complaint will be acknowledged, in writing, within 3 (three) business days of the complaint being received.',
        'A final response to your complaint will be provided to you, in writing, within 1 (one) month of the complaint being received. If those timeframes cannot be met, the reasons must be provided in writing, together with the period within which a definite answer can be expected.',
        "Should you remain dissatisfied with the final response, you may refer your complaint to the Insurance Ombudsman in Belgium. Lloyd's Insurance Company S.A. is authorised and regulated by the National Bank of Belgium and regulated by the Financial Services and Markets Authority.",
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
  },

  NL: {
    governingLaw: 'NETHERLANDS Law',
    jurisdiction: 'NETHERLANDS',
    serviceOfSuit: {
      recipients: [
        {
          name: "General Representative for the Netherlands, Lloyd's Insurance Company S.A.",
          addressLines: [
            'Beurs World Trade Center',
            'Beursplein 37',
            'P.O. Box 30196',
            '3001 DD Rotterdam',
            'The Netherlands',
          ],
        },
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
    complaints: {
      ombudsmanName: 'Klachteninstituut Financiële Dienstverlening (Kifid)',
      ombudsmanPostal: 'Postbus 93257\n2509 AG The Hague\nThe Netherlands',
      ombudsmanTel: '+31 (0) 70 333 8 999',
      ombudsmanEmail: 'consumenten@kifid.nl',
      authorityName: 'De Nederlandsche Bank / AFM',
      authorityWebsite: 'info@dnb.nl',
      procedureParagraphs: [
        'Your complaint will be acknowledged, in writing, within 2 (two) weeks of the complaint being received.',
        'A final response to your complaint will be provided to you, in writing, within 8 (eight) weeks of the complaint being received.',
        'Should you remain dissatisfied with the final response, or if you have not received a final response within 8 (eight) weeks after the complaint has been received by the insurer, you may refer your complaint to Kifid (Klachteninstituut Financiële Dienstverlening). Complaints about financial institutions may also be brought to De Nederlandsche Bank (info@dnb.nl) or to the AFM via the AFM consumer contact and reporting process.',
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
  },

  IT: {
    governingLaw: 'ITALY Law',
    jurisdiction: 'ITALY',
    serviceOfSuit: {
      recipients: [
        {
          name: "Lloyd's Insurance Company S.A.",
          addressLines: [
            'Bastion Tower',
            'Marsveldplein 5',
            '1050 Brussels',
            'Belgium',
          ],
        },
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
    complaints: {
      ombudsmanName: 'Institute for Insurance Supervision (IVASS)',
      ombudsmanPostal: 'Via del Quirinale 21\n00187 Rome\nItaly',
      ombudsmanTel: '800 486661 (Italy) / +39 06 404 14 679 (outside Italy)',
      ombudsmanFax: '+39 06 42133 206',
      ombudsmanEmail: 'tutela.consumatore@pec.ivass.it',
      procedureParagraphs: [
        'Italy does not require a separate acknowledgement of receipt of your complaint. Where sensitive personal data is involved, a privacy notice and request for signed consent will be provided; the response deadline runs from receipt of the required consent to process sensitive data.',
        'A final response to your complaint will be provided to you, in writing, within 45 (forty-five) calendar days of the privacy notice and signed consent being received.',
        'Should you remain dissatisfied with the final response, or if you have not received a final response within 45 (forty-five) calendar days, you may refer your complaint to IVASS (Institute for Insurance Supervision).',
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
  },

  FR: {
    governingLaw: 'FRANCE Law',
    jurisdiction: 'FRANCE',
    serviceOfSuit: {
      recipients: [
        {
          name: "General Representative for France, Lloyd's Insurance Company S.A.",
          addressLines: [
            '8/10 Rue Lamennais',
            '75008 Paris',
            'France',
          ],
        },
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
    complaints: {
      ombudsmanName: 'Insurance Ombudsman',
      ombudsmanPostal: 'TSA 50110\n75441 Paris Cedex 09\nFrance',
      authorityName: 'Autorité de contrôle prudentiel et de résolution (ACPR)',
      authorityPostal: '4 Place de Budapest\nCS 92459\n75436 Paris Cedex 09\nFrance',
      authorityTel: '+33 1 49 95 40 00',
      procedureParagraphs: [
        'Your complaint will be acknowledged, in writing, within 10 (ten) business days of the complaint being received.',
        'A final response to your complaint will be provided to you, in writing, within 2 (two) months of the complaint being received.',
        'Should you remain dissatisfied with the final response, or if you have not received a final response within 2 (two) months of the complaint being made, you may refer your complaint to the Insurance Ombudsman in France.',
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
  },

  MT: {
    governingLaw: 'MALTA Law',
    jurisdiction: 'MALTA',
    serviceOfSuit: {
      recipients: [
        {
          name: "Lloyd's Insurance Company S.A.",
          addressLines: [
            'Bastion Tower',
            'Marsveldplein 5',
            '1050 Brussels',
            'Belgium',
          ],
        },
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
    complaints: {
      ombudsmanName: 'Office of the Arbiter for Financial Services',
      ombudsmanPostal: 'St Calcedonius Square\nFloriana FRN 1530\nMalta',
      ombudsmanTel: '80072366 (inside Malta) / +356 212 49245 (outside Malta) / +356 79219961 (mobile and WhatsApp)',
      ombudsmanEmail: 'complaint.info@asf.mt',
      authorityName: 'Malta Financial Services Authority (MFSA)',
      procedureParagraphs: [
        'Your complaint will be acknowledged, in writing, within 5 (five) business days of the complaint being received.',
        'A final response to your complaint will be provided to you, in writing, within 15 (fifteen) working days of the complaint being made.',
        'Should you remain dissatisfied with the final response, or if you have not received a final response within 15 (fifteen) working days of the complaint being made, you may refer your complaint to the Arbiter for Financial Services in Malta. The Malta Financial Services Authority directs consumer complaints against licensed financial institutions to the Office of the Arbiter for Financial Services.',
      ],
      referenceCode: 'LBS0081',
      referenceDate: '01/12/2019',
    },
  },
};

/**
 * Per-country Travel document preset constants. Used by
 * `JURISDICTION_TRAVEL_DOCUMENT_PRESETS` below. Local Charles Taylor
 * numbers per Peter 2026-05-16; CY/PT/MT have no dedicated local CEGA
 * number — central CEGA handles assistance until Charles Taylor confirms.
 */
const CEGA_GENERAL_TELEPHONE = '+44 (0)1243 219 600';
const CEGA_MEDICAL_TELEPHONE = '+44 (0)1243 621 107';
const EU_STANDARD_WORDING = 'EU Standard Wording 2026';

type JurisdictionDocumentPreset = Omit<DocumentJurisdictionConfig, 'locationLabel'>;

function travelPreset(args: {
  countryCode: JurisdictionCountryCode;
  assistanceLocalNumbers?: Array<{ city: string; phone: string }>;
}): JurisdictionDocumentPreset {
  return {
    wordingReference: EU_STANDARD_WORDING,
    assistanceProvider: 'CEGA / Charles Taylor Assistance',
    assistanceTelephone: CEGA_MEDICAL_TELEPHONE,
    roadsideAssistanceLabel: 'Travel Assistance',
    legalAssistanceLabel: 'Travel Legal Assistance',
    ...(args.assistanceLocalNumbers ? { assistanceLocalNumbers: args.assistanceLocalNumbers } : {}),
    ...(TRAVEL_LEGAL_CONTACTS[args.countryCode]
      ? { travelLegal: TRAVEL_LEGAL_CONTACTS[args.countryCode] }
      : {}),
    premiumDisplay: {
      showNet: true,
      showTaxBreakdown: true,
      ordering: ['NET_PREMIUM', 'IPT', 'PENSION_FUND', 'WINDING_UP_FUND', 'STAMP_DUTY'],
      labels: {
        NET_PREMIUM: 'Net Premium',
        IPT: 'Insurance Premium Tax',
        PENSION_FUND: 'Pension Fund Levy',
        WINDING_UP_FUND: 'Winding-up Fund',
        STAMP_DUTY: 'Stamp Duty',
      },
    },
  };
}

export const JURISDICTION_TRAVEL_DOCUMENT_PRESETS: Record<Exclude<JurisdictionCountryCode, 'US'>, JurisdictionDocumentPreset> = {
  CY: travelPreset({ countryCode: 'CY' }),
  PT: travelPreset({ countryCode: 'PT' }),
  MT: travelPreset({ countryCode: 'MT' }),
  BE: travelPreset({ countryCode: 'BE', assistanceLocalNumbers: [{ city: 'Antwerp', phone: '+32 36 001 705' }] }),
  FR: travelPreset({ countryCode: 'FR', assistanceLocalNumbers: [{ city: 'Paris', phone: '+33 153 43 00 30' }] }),
  GR: travelPreset({ countryCode: 'GR', assistanceLocalNumbers: [{ city: 'Athens', phone: '+30 6977 402 510' }] }),
  IT: travelPreset({
    countryCode: 'IT',
    assistanceLocalNumbers: [
      { city: 'Genoa', phone: '+39 010 6469694' },
      { city: 'Milan / Rome', phone: '+39 06 9480 6000' },
    ],
  }),
  ES: travelPreset({
    countryCode: 'ES',
    assistanceLocalNumbers: [
      { city: 'Madrid', phone: '+34 685 40 33 51' },
      { city: 'Palma', phone: CEGA_GENERAL_TELEPHONE },
    ],
  }),
  NL: travelPreset({ countryCode: 'NL', assistanceLocalNumbers: [{ city: 'Rotterdam', phone: '+31 (0)10 216 26 88' }] }),
};
