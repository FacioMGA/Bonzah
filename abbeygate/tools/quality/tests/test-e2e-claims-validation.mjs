const baseUrl = 'http://localhost:3000/api/v1';
const apiKey = String(process.env.API_V1_TEST_KEY || 'facio_test_placeholder_change_me');

const quotePayload = {
  programId: '11111111-1111-4111-8111-111111111111',
  effectiveDate: '2026-03-01T00:00:00.000Z',
  quoteData: {
    coverRequired: 'Comprehensive',
    drivingExperienceFormat: 'UK Format',
    drivers: [
      {
        type: 'Policyholder',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1980-01-01T00:00:00.000Z',
        drivingExperience: '5 or more years NCD',
        convictions: [],
        accidents: [],
      },
    ],
    namedDrivers: [],
    vehicleValue: 15000,
    vehicleMake: 'Ford',
    vehicleModel: 'Focus',
    vehicleYear: '2020',
    vehicleRegistration: 'AB12CDE',
    vehicleLocation: 'Cyprus',
    vehicleType: 'Standard',
    vehicleTransmission: 'Automatic',
    vehicleFuelType: 'Petrol',
    expectedAnnualMileage: '10000_15000',
    usage: 'Social, Domestic and Pleasure',
    overnightLocation: 'Driveway',
    addressLine1: '123 Test Street',
    addressLine2: '',
    addressCity: 'Limassol',
    addressPostalCode: '4000',
    countryIsoCode: 'CY',
    email: 'john.doe@example.com',
    phone: '+35799123456',
    flags: {
      classic_car: false,
    },
  },
};

async function run() {
  console.log('1. Generating Quote...');
  let res = await fetch(`${baseUrl}/quotes`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(quotePayload),
  });
  const quote = await res.json();
  if (!quote.success) throw new Error(`Quote failed: ${JSON.stringify(quote)}`);
  console.log(`Quote Success: ${quote.data.quoteId}`);

  console.log('2. Binding Policy...');
  res = await fetch(`${baseUrl}/quotes/${quote.data.quoteId}/bind`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agreeTerms: true }),
  });
  const bind = await res.json();
  if (!bind.success) throw new Error(`Bind failed: ${JSON.stringify(bind)}`);
  console.log(`Bind Success: Policy ${bind.data.policyId}`);

  const policyId = bind.data.policyId;

  const invalidPayload = {
    policyId,
    incidentDate: '2026-05-15T14:30:00.000Z',
    claimType: 'COLLISION',
    description: 'I hit a completely empty and stationary wall. No one was around.',
    fnolData: {
      incident: {
        type: 'collision',
        date: '2026-05-15',
        time: '14:30',
        location: 'Empty Street 1',
        city: 'London',
        country: 'UK',
        description: 'I hit a completely empty and stationary wall.',
      },
      driver: {
        kind: 'named',
        id: 'policyholder-driver',
      },
      thirdParty: {
        involved: 'no', // 'collision' requires a third party for Abbeygate
      },
      police: {
        involved: false,
      },
      triage: {
        carDrivable: 'yes',
        needTow: false,
        injuriesReported: 'no',
      },
    },
  };

  console.log('3. Submitting Purposely Invalid Guided FNOL Claim...');
  res = await fetch(`${baseUrl}/claims`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(invalidPayload),
  });

  const json = await res.json();
  console.log(`\nStatus Code HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));
}

run().catch(console.error);
