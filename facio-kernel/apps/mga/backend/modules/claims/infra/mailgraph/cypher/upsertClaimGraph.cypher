// upsertClaimGraph.cypher — pipeline step 8 (ADR-0041, extended ADR-0044).
//
// Idempotent MERGE-only rebuild of one claim's graph footprint.  Run
// inside a single transaction; every parameter is tenant-scoped via
// `$tenantId` per ADR-0041 §1 / §5.
//
// ADR-0044 adds:
//   - typed edge metadata on EVERY relationship (`SET r += $edgeMeta`):
//     { edgeClass, confidence, sourceType, createdBy, createdAt }.
//   - new node labels: Document, Rule, Endorsement, MemoryObject.
//   - new edges: HAS_DOCUMENT, HAS_MISSING_EVIDENCE, MATCHES_RULE,
//     TRIGGERS_GATE, HAS_MEMORY, SUPPORTED_BY (Event->Message already
//     modelled as CITED_BY). :SIMILAR_TO is written by findSimilarClaims.
//
// Parameters:
//   $tenantId         (string)  operating tenant id.
//   $claimId          (string)  Claim node id.
//   $product          (string|null)
//   $jurisdiction     (string|null)
//   $status           (string)
//   $summary          (string|null) memory-object summary.
//   $edgeMeta         (map)     deterministic edge metadata applied to structural edges.
//   $repairers        (list<{repairerId, normalizedName}>)
//   $brokers          (list<{brokerId, normalizedName}>)
//   $vehicles         (list<{vehicleHash}>)
//   $events           (list<{eventId, type, date, reasonCode?, documentType?, amount?, citation}>)
//   $threads          (list<{threadId, messages: [{messageId, sentAt, senderDomain, messageType}]}>)
//   $documents        (list<{documentId, documentType, citationMessageId?}>)
//   $missingEvidence  (list<{documentType, received}>)
//   $endorsements     (list<{endorsementRef, status, governingSourceId?}>)
//   $gates            (list<{code, status, summary}>)

MERGE (claim:Claim {claimId: $claimId, tenantId: $tenantId})
SET claim.product = $product,
    claim.jurisdiction = $jurisdiction,
    claim.status = $status,
    claim.updatedAt = datetime()

// Memory object node (one per claim) — the durable "living memory" anchor.
MERGE (mo:MemoryObject {claimId: $claimId, tenantId: $tenantId})
SET mo.summary = $summary,
    mo.generatedAt = datetime()
MERGE (claim)-[rmo:HAS_MEMORY]->(mo)
SET rmo += $edgeMeta

WITH claim
UNWIND $threads AS thread
MERGE (t:EmailThread {threadId: thread.threadId, tenantId: $tenantId})
SET t.claimId = $claimId
MERGE (claim)-[rt:HAS_THREAD]->(t)
SET rt += $edgeMeta
WITH claim, thread, t
UNWIND thread.messages AS message
MERGE (m:Message {messageId: message.messageId, tenantId: $tenantId})
SET m.sentAt = datetime(message.sentAt),
    m.senderDomain = message.senderDomain,
    m.messageType = message.messageType
MERGE (t)-[rm:HAS_MESSAGE]->(m)
SET rm += $edgeMeta

WITH DISTINCT claim
UNWIND $repairers AS repairer
MERGE (r:Repairer {repairerId: repairer.repairerId, tenantId: $tenantId})
SET r.normalizedName = repairer.normalizedName
MERGE (claim)-[rr:USES_REPAIRER]->(r)
SET rr += $edgeMeta

WITH DISTINCT claim
UNWIND $brokers AS broker
MERGE (b:Broker {brokerId: broker.brokerId, tenantId: $tenantId})
SET b.normalizedName = broker.normalizedName
MERGE (claim)-[rb:INVOLVES_BROKER]->(b)
SET rb += $edgeMeta

WITH DISTINCT claim
UNWIND $vehicles AS vehicle
MERGE (v:Vehicle {vehicleHash: vehicle.vehicleHash, tenantId: $tenantId})
MERGE (claim)-[rv:INVOLVES_VEHICLE]->(v)
SET rv += $edgeMeta

WITH DISTINCT claim
UNWIND $events AS event
MERGE (e:Event {eventId: event.eventId, tenantId: $tenantId})
SET e.type = event.type,
    e.date = date(event.date),
    e.reasonCode = event.reasonCode,
    e.documentType = event.documentType,
    e.amount = event.amount
MERGE (claim)-[re:HAS_EVENT]->(e)
SET re += $edgeMeta
WITH claim, event, e
WHERE event.citation IS NOT NULL AND event.citation.messageId IS NOT NULL
MATCH (citedMsg:Message {messageId: event.citation.messageId, tenantId: $tenantId})
MERGE (e)-[rc:CITED_BY]->(citedMsg)
SET rc += $edgeMeta

WITH DISTINCT claim
UNWIND $documents AS doc
MERGE (d:Document {documentId: doc.documentId, tenantId: $tenantId})
SET d.documentType = doc.documentType
MERGE (claim)-[rd:HAS_DOCUMENT]->(d)
SET rd += $edgeMeta

WITH DISTINCT claim
UNWIND $missingEvidence AS miss
MERGE (me:Document {documentId: $claimId + ':missing:' + miss.documentType, tenantId: $tenantId})
SET me.documentType = miss.documentType,
    me.received = miss.received
MERGE (claim)-[rme:HAS_MISSING_EVIDENCE]->(me)
SET rme += $edgeMeta

WITH DISTINCT claim
UNWIND $endorsements AS endo
MERGE (en:Endorsement {endorsementRef: endo.endorsementRef, tenantId: $tenantId})
SET en.status = endo.status,
    en.governingSourceId = endo.governingSourceId
MERGE (claim)-[ren:MATCHES_RULE]->(en)
SET ren += $edgeMeta

WITH DISTINCT claim
UNWIND $gates AS gate
MERGE (g:Rule {ruleId: $claimId + ':gate:' + gate.code, tenantId: $tenantId})
SET g.code = gate.code,
    g.status = gate.status,
    g.summary = gate.summary
MERGE (claim)-[rg:TRIGGERS_GATE]->(g)
SET rg += $edgeMeta

RETURN $claimId AS claimId
