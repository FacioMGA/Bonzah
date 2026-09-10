// similarClaimsByEntity.cypher — ADR-0041 §6.1.
//
// Returns up to 5 OTHER claims in the same tenant that share at least
// one entity (repairer, broker, or vehicle) with `$claimId`.
//
// Parameters:
//   $tenantId  (string)  tenant scope.
//   $claimId   (string)  claim to compare against.
//
// Output rows: { claimId, sharedSignals[], signalCount }.

MATCH (c:Claim {claimId: $claimId, tenantId: $tenantId})
MATCH (c)-[:USES_REPAIRER|INVOLVES_BROKER|INVOLVES_VEHICLE]->(e)<-[:USES_REPAIRER|INVOLVES_BROKER|INVOLVES_VEHICLE]-(other:Claim)
WHERE other.claimId <> c.claimId AND other.tenantId = $tenantId
RETURN other.claimId AS claimId,
       collect(DISTINCT labels(e)[0] + ':' + coalesce(e.normalizedName, e.vehicleHash, e.normalizedValueHash)) AS sharedSignals,
       count(DISTINCT e) AS signalCount
ORDER BY signalCount DESC
LIMIT 5
