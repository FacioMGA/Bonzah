UPDATE communication_templates
SET
  "subjectTemplate" = 'Your {{quote.productLabel}}',
  "bodyTemplate" = 'Hi {{customer.firstName}},

Your {{quote.productLabel}} is ready for {{policy.vehicleDescription}}.

Quote reference: {{quote.reference}}
Premium: {{quote.premium}}
Excess: {{quote.excess}}

Please review it using the secure link below:
{{quote.url}}

Important: cover does not start until payment is completed and confirmation has been issued.',
  "variablesSchema" = jsonb_build_object(
    'customer.firstName', 'required',
    'policy.vehicleDescription', 'required',
    'quote.productLabel', 'required',
    'quote.reference', 'required',
    'quote.premium', 'required',
    'quote.excess', 'required',
    'quote.url', 'required'
  ),
  "updatedAt" = now()
WHERE name = 'QUOTE_STANDARD'
  AND channel = 'EMAIL';
