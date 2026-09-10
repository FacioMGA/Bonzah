#!/bin/bash
API_KEY="${API_V1_TEST_KEY:-facio_test_placeholder_change_me}"
BASE_URL="http://localhost:3000/api/v1"

echo "=================================================="
echo "1. Standard Quote Request (Defaults only)"
RES1=$(curl -s -X POST $BASE_URL/quotes \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "programId": "11111111-1111-4111-8111-111111111111",
    "effectiveDate": "2026-03-01T00:00:00.000Z",
    "quoteData": {
        "firstName": "Testing",
        "lastName": "Base",
        "email": "base@example.com",
        "dateOfBirth": "1990-01-01T00:00:00.000Z",
        "vehicleValue": 10000,
        "engineSize": 1500,
        "vehicleType": "Private Car",
        "coverRequired": "Comprehensive",
        "year": 2018,
        "make": "Toyota",
        "model": "Corolla",
        "countryOfRegistration": "Cyprus"
    }
}')
echo $RES1 | jq .

echo "=================================================="
echo "2. Upselling Breakdown Cover (COV-ROADSIDE-VIP is an optional upsell in Abbeygate defaults)"
RES2=$(curl -s -X POST $BASE_URL/quotes \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "programId": "11111111-1111-4111-8111-111111111111",
    "effectiveDate": "2026-03-01T00:00:00.000Z",
    "quoteData": {
        "firstName": "Testing",
        "lastName": "Upsell",
        "email": "upsell@example.com",
        "dateOfBirth": "1990-01-01T00:00:00.000Z",
        "vehicleValue": 10000,
        "engineSize": 1500,
        "vehicleType": "Private Car",
        "coverRequired": "Comprehensive",
        "year": 2018,
        "make": "Toyota",
        "model": "Corolla",
        "countryOfRegistration": "Cyprus"
    },
    "endorsements": {
      "selectedOptions": {
        "COV-ROADSIDE-VIP": true
      }
    }
}')
echo $RES2 | jq .
