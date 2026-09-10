const url = 'http://localhost:3000/api/v1/claims';
const apiKey = String(process.env.API_V1_TEST_KEY || 'facio_test_placeholder_change_me');

// This is an invalid claim (using collision, but setting thirdParty = 'no' which is required by the product rule)
const invalidPayload = {
  policyId: 'b365d463-d2bb-4358-b9a9-2503e56398fc', // Replace with real E2E policy UUID
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
      involved: 'no', // 'collision' requires a third party for Abbeygate currently unless overriden. We'll see what the engine says.
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

async function test() {
  console.log('1. Submitting Purposely Invalid Guided FNOL Claim...');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(invalidPayload),
  });

  const json = await res.json();
  console.log(`\nStatus Code HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));
}

test().catch(console.error);
