// claimsWithMissingDocPattern.cypher — ADR-0041 §6.2.
//
// Returns up to 5 OTHER claims in the same tenant that have at least
// one `doc_request` event of the same documentType as `$claimId`.
//
// Parameters:
//   $tenantId  (string)
//   $claimId   (string)
//
// Output rows: { claimId, sharedMissingDocs[] }.

MATCH (c:Claim {claimId: $claimId, tenantId: $tenantId})-[:HAS_EVENT]->(e:Event {type:'doc_request'})
MATCH (other:Claim {tenantId: $tenantId})-[:HAS_EVENT]->(oe:Event {type:'doc_request'})
WHERE other.claimId <> c.claimId
  AND oe.documentType = e.documentType
RETURN other.claimId AS claimId,
       collect(DISTINCT e.documentType) AS sharedMissingDocs
LIMIT 5
