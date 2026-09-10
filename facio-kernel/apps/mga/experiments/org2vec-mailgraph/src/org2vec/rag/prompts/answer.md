Question:

{question}

Claim under review: {claim_id}

Evidence pack (use the IDs exactly as given):

{evidence}

Return a single JSON object matching this schema:

{schema}

Constraints:

- Every ``missing_information`` item MUST cite an email or rule that supports
  that the item is missing or required.
- Every ``authority_flag`` MUST cite the email containing the trigger (e.g.
  the estimate amount), AND ideally a rule citation for the threshold.
- Every ``recommended_next_actions`` item MUST cite the evidence that
  motivates it.
- Citations use thread_id / message_id from "email" items and doc_id /
  chunk_id from "rule" items, exactly as given above. Quotes must be
  verbatim short excerpts.
