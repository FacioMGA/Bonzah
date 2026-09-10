// claimsWithEscalationPattern.cypher — ADR-0041 §6.3.
//
// Returns up to 5 OTHER claims in the same tenant whose escalation
// events share the same reasonCode as `$claimId`.
//
// Parameters:
//   $tenantId  (string)
//   $claimId   (string)
//
// Output rows: { claimId, reasonCode, date }.

MATCH (c:Claim {claimId: $claimId, tenantId: $tenantId})-[:HAS_EVENT]->(e:Event {type:'escalation'})
MATCH (other:Claim {tenantId: $tenantId})-[:HAS_EVENT]->(oe:Event {type:'escalation'})
WHERE other.claimId <> c.claimId
  AND oe.reasonCode = e.reasonCode
RETURN other.claimId AS claimId,
       oe.reasonCode AS reasonCode,
       toString(oe.date) AS date
LIMIT 5
