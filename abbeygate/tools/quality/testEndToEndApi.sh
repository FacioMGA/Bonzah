#!/bin/bash
API_KEY="${API_V1_TEST_KEY:-facio_test_placeholder_change_me}"
BASE_URL="http://localhost:3000/api/v1"

echo "1. Generating Quote (POST /v1/quotes)..."
QUOTE_RES=$(curl -s -X POST $BASE_URL/quotes \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "programId": "11111111-1111-4111-8111-111111111111",
    "quoteData": {
        "firstName": "Curl",
        "lastName": "Integration",
        "email": "curl@integration.test",
        "telephone": "+44 7700 900077",
        "dateOfBirth": "1985-06-15T00:00:00.000Z",
        "addressLine": "123 Integration Lane",
        "city": "London",
        "province": "Greater London",
        "postCode": "W1A 1AA",
        "country": "United Kingdom",
        "nationality": "United Kingdom",
        "occupation": "Software Engineer",
        "whereDidYouHear": "Friend",
        "licenseYears": 10,
        "licenseType": "Full",
        "licenseIssuedIn": "UK",
        "hasClaims": false,
        "hasConvictions": false,
        "vehicleLocation": "Driveway",
        "coverRequired": "Comprehensive",
        "renewalDate": "2026-03-01T00:00:00.000Z",
        "vehicleType": "Car",
        "make": "Toyota",
        "model": "Corolla",
        "cabrio": "No",
        "fuelType": "Petrol",
        "kmsPerYear": "10000-15000",
        "year": 2018,
        "countryOfRegistration": "Cyprus",
        "registrationNumber": "ABC1234",
        "numberOfSeats": 5,
        "modified": false,
        "engineSize": 1500,
        "vehicleValue": 15000,
        "ncb": "5 Years",
        "vehicleUse": "SD&P",
        "requiredExcess": "250",
        "bestTimeToCall": "Morning",
        "infoTrueAndAccurate": true,
        "fairProcessingAccepted": true,
        "privacyPolicyAccepted": true
    },
    "effectiveDate": "2026-03-01T00:00:00.000Z"
}')

echo $QUOTE_RES | jq .

QUOTE_TOKEN=$(echo $QUOTE_RES | jq -r .data.quoteToken)
QUOTE_ID=$(echo $QUOTE_RES | jq -r .data.quoteId)
QUOTE_STATUS=$(echo $QUOTE_RES | jq -r .data.status)

if [ "$QUOTE_STATUS" != "QUOTED" ]; then
  echo "Failed to get a clean QUOTED status!"
  exit 1
fi

echo "=================================================="
echo "2. Binding Policy using Quote Token (POST /v1/policies)..."
BIND_RES=$(curl -s -X POST $BASE_URL/policies \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "quoteId": "'"$QUOTE_ID"'",
    "quoteToken": "'"$QUOTE_TOKEN"'",
    "paymentMethod": {
        "type": "INVOICE"
    }
}')

echo $BIND_RES | jq .

POLICY_ID=$(echo $BIND_RES | jq -r .data.id)

echo "=================================================="
echo "3. Quoting Endorsement (MTA) (POST /v1/policies/$POLICY_ID/endorsements/quote)..."
MTA_QUOTE_RES=$(curl -s -X POST $BASE_URL/policies/$POLICY_ID/endorsements/quote \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "effectiveDate": "2026-06-01T00:00:00.000Z",
    "changes": {
        "vehicleValue": 25000,
        "engineSize": 2000
    },
    "reason": "Upgraded vehicle mid-term"
}')

echo $MTA_QUOTE_RES | jq .

MTA_QUOTE_ID=$(echo $MTA_QUOTE_RES | jq -r .data.quoteId)

echo "=================================================="
echo "4. Binding Endorsement (POST /v1/policies/$POLICY_ID/endorsements/bind)..."
MTA_BIND_RES=$(curl -s -X POST $BASE_URL/policies/$POLICY_ID/endorsements/bind \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"quoteId\": \"$MTA_QUOTE_ID\"
}")

echo $MTA_BIND_RES | jq .

echo "=================================================="
echo "5. Retrieving Generated Documents (GET /v1/policies/$POLICY_ID/documents)..."
echo "Waiting 6 seconds for async document generation workers to finish..."
sleep 6

DOCS_RES=$(curl -s -X GET $BASE_URL/policies/$POLICY_ID/documents \
  -H "x-api-key: $API_KEY")

echo $DOCS_RES | jq .

exit 0
