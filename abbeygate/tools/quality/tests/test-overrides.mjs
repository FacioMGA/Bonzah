const url = 'http://localhost:3000/api/v1/quotes';
const apiKey = String(process.env.API_V1_TEST_KEY || 'facio_test_placeholder_change_me');

const basePayload = {
  programId: '11111111-1111-4111-8111-111111111111',
  effectiveDate: '2026-03-01T00:00:00.000Z',
  quoteData: {
    firstName: 'Test',
    lastName: 'Base',
    email: 'test@example.com',
    telephone: '+44 7700 900077',
    dateOfBirth: '1985-06-15T00:00:00.000Z',
    addressLine: '123 Lane',
    city: 'London',
    province: 'Greater London',
    postCode: 'W1A 1AA',
    country: 'UK',
    nationality: 'United Kingdom',
    occupation: 'Engineer',
    whereDidYouHear: 'Friend',
    licenseYears: 10,
    licenseType: 'Full',
    licenseIssuedIn: 'UK',
    hasClaims: false,
    hasConvictions: false,
    vehicleLocation: 'Driveway',
    coverRequired: 'Comprehensive',
    renewalDate: '2026-03-01T00:00:00.000Z',
    vehicleType: 'Car',
    make: 'Toyota',
    model: 'Corolla',
    cabrio: 'No',
    fuelType: 'Petrol',
    kmsPerYear: '10000-15000',
    year: 2018,
    countryOfRegistration: 'Cyprus',
    registrationNumber: 'ABC1234',
    numberOfSeats: 5,
    modified: false,
    engineSize: 1500,
    vehicleValue: 15000,
    ncb: '5 Years',
    vehicleUse: 'SD&P',
    requiredExcess: '250',
    bestTimeToCall: 'Morning',
    infoTrueAndAccurate: true,
    fairProcessingAccepted: true,
    privacyPolicyAccepted: true,
  },
};

const overridePayload = {
  ...basePayload,
  endorsements: {
    selectedOptions: {
      'COV-ROADSIDE-VIP': true,
    },
  },
};

async function test() {
  console.log('1. Requesting Standard Quote...');
  const res1 = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(basePayload),
  });
  const json1 = await res1.json();
  console.log(`Standard Premium: EUR ${json1.data?.premiumCalculated}`);
  console.log('Standard Applied Endorsements:');
  console.log(json1.data?.endorsements?.applied?.map((e) => e.code).join(', '));

  console.log('\n------------------------------------------------\n');

  console.log('2. Requesting Quote with VIP Roadside Upsell...');
  const res2 = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(overridePayload),
  });
  const json2 = await res2.json();
  console.log(`Override Premium: EUR ${json2.data?.premiumCalculated}`);
  console.log('Override Applied Endorsements:');
  console.log(json2.data?.endorsements?.applied?.map((e) => e.code).join(', '));

  const diff = (json2.data?.premiumCalculated || 0) - (json1.data?.premiumCalculated || 0);
  console.log(`\nPrice Difference for adding COV-ROADSIDE-VIP: EUR ${diff.toFixed(2)}`);
}

test().catch(console.error);
