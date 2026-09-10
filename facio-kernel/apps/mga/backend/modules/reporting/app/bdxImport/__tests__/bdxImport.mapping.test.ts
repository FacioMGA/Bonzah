import { describe, expect, it } from 'vitest';
import { mapRawRowToDto } from '../mapper.js';

describe('BDX product mappers', () => {
  it('maps Lloyds v5.2 travel rows into product quote data', () => {
    const dto = mapRawRowToDto({
      __productLine: 'travel', __sourceMonth: '2026-04', 'Class of Business': 'TRAVEL',
      'Certificate Ref': 'BRIT/ABG/0001', 'Policy or Group Ref': 'DIRECT/BRIT/ABG/0001',
      'Risk, Transaction Type': 'NB', 'Risk Inception Date': '2026-04-01', 'Risk Expiry Date': '2027-04-01',
      'Effective Date of Transaction': '2026-03-25', 'Insured First Name': 'Ada',
      'Insured Full Name, Last Name or Company Name': 'Traveller', 'Insured Country (see code list)': 'Portugal',
      'Total gross written premium': 120, 'Coverholder commission amount for whole risk/written premium': 36,
      'Total taxes payable locally': 6, 'Net written Premium to London in original currency': 84,
      'Level of Cover': 'Gold', 'Area of Cover': 'WorldwideInc', Travellers: 'Couple',
      'Type of Cover': 'Multi Trip', 'Number of Days': 31, 'Traveller 1 DOB': '1980-01-01',
    }, 6);
    expect(dto.productType).toBe('TRAVEL');
    expect(dto.productLine).toBe('travel');
    expect(dto.policyRef).toBe('BRIT/ABG/0001');
    expect(dto.sourceId).toBe('BRIT/ABG/0001');
    expect(dto.productData?.quote).toMatchObject({ selectedPlan: 'gold' });
    expect(dto.productData?.trip).toMatchObject({ planType: 'annual_multi_trip' });
  });

  it('maps historical Britt Travel BDX eligibility assertions for import reconstruction', () => {
    const dto = mapRawRowToDto({
      __productLine: 'travel', __sheetName: 'Sheet1', 'Class of Business': 'TRAVEL',
      'Certificate Ref': 'BRIT/ABG/00002017', 'Risk, Transaction Type': 'NB',
      'Risk Inception Date': '2025-06-21', 'Risk Expiry Date': '2026-06-21',
      'Insured First Name': 'Teresa', 'Insured Full Name, Last Name or Company Name': 'Cotton',
      'Insured Country (see code list)': 'Cyprus', 'Total gross written premium': 182.29,
      'Coverholder commission amount for whole risk/written premium': 42.84, 'Total taxes payable locally': 2,
      'Net written Premium to London in original currency': 137.45, 'Level of Cover': 'Platinum',
      'Type of Cover': 'Multi Trip', 'Number of Days': 31, 'Traveller 1 DOB': '1957-03-23',
      'Traveller 2 Name': 'Roger Cotton', 'Traveller 2 DOB': '1950-08-25', 'Traveller 2 NIE': '129084162',
      Travellers: 'Couple',
    }, 2);
    expect(dto.productData?.bdxImportAssertions).toMatchObject({ profile: 'BDX_HISTORICAL_TRAVEL_LLOYDS_V52_BRITT_2025_2026' });
    expect(dto.productData?.eligibility).toMatchObject({
      countryOfResidence: 'Republic of Cyprus', nationality: 'United Kingdom', hasOtherNationality: false,
      residenceDuration: 'gt_3_years', willRemainResident: true, residencyStatus: 'permanent_resident',
      legallyPermittedToReside: true, informationAccurate: true,
    });
    expect(dto.productData?.travellers).toMatchObject({
      coverType: 'couple', travellerCount: 2, additionalTravellerDOBs: ['1950-08-25'],
      additionalTravellers: [{ firstName: 'Roger', lastName: 'Cotton', idType: 'id_card', idNumber: '129084162' }],
    });
  });

  it('maps Lloyds v5.2 home rows into product quote data', () => {
    const dto = mapRawRowToDto({
      __productLine: 'home', __sheetName: 'Cyprus', 'Class of Business': 'PROPERTY',
      'Certificate Ref': 'BZ/ABG/0001', 'Risk, Transaction Type': 'NB', 'Risk Start Date': '2026-04-01',
      'Risk End Date & Transaction End Date': '2027-04-01', 'Date Issue of Schedule': '2026-03-25',
      'Insured First Name': 'Ada', 'Insured Full Name, Last Name or Company Name': 'Home',
      'Insured Country (see code list)': 'Cyprus', 'Risk Gross Total Premium (ex Ipt)': 200,
      'Total Commission': 50, IPT: 10, 'Risk Net Total Premium (ex Ipt)': 150,
      'Total Gross Premium including IPT': 210, 'Property Type': 'Villa', 'Buildings Sum Insured': 100000,
      'Contents Sum Insured': 25000, 'No Of Beds': 3,
    }, 4);
    expect(dto.productType).toBe('HOME');
    expect(dto.productLine).toBe('home');
    expect(dto.productData?.property).toMatchObject({ propertyType: 'Villa' });
    expect(dto.productData?.coverage).toMatchObject({ buildings: 100000, contents: 25000 });
  });
});
