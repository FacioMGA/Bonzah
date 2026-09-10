# org2vec namespace — graph enrichment plane (ADR-0041)

This namespace deploys the **off-the-critical-path** Claim Memory
enrichment plane. The API + abbeygate-worker Deployments NEVER live
here (`check-neo4j-no-app-pod-coupling` guard enforces this).

## What lives here

```
namespace: org2vec
  Deployment:  org2vec-worker         (consumes CLAIM_MEMORY.REFRESH BullMQ jobs)
  StatefulSet: neo4j                  (single-instance, dev/demo only)
  PVC:         neo4j-data
  Service:     neo4j (ClusterIP, no public endpoint)
  SecretProviderClass: neo4j-secrets  (Workload Identity → Azure Key Vault)
  CronJob:     neo4j-dump-to-blob     (nightly @ 02:30 UTC)
  CronJob:     neo4j-restore-smoke-test (weekly, scratch namespace)
```

## Two acceptable shapes

| Option | When | Trade-off |
|---|---|---|
| **A. Neo4j AuraDB** (managed) | Default for staging + prod. | $$ but zero ops; managed backups; documented SLA. The StatefulSet here is NOT deployed. The `org2vec-worker` reads `NEO4J_URI=neo4j+s://<dbid>.databases.neo4j.io` from Key Vault. |
| **B. Single-instance StatefulSet** | Internal dev / demo only. | Free, but you own backups + restore tests. |

In Option A the `neo4j/statefulset.yaml` manifest is intentionally NOT
applied; only the `worker/` Deployment runs, with `NEO4J_URI` pointing
at the AuraDB endpoint.

## Failure-mode contract

Per ADR-0041 §8, every component in this namespace is off the critical
path of `abbeygate-api` and `abbeygate-worker`. If Neo4j is unreachable
the refresh worker writes the projection with `refreshStatus='failed'`
and the Claim Workspace renders the previous projection with a stale
banner. No claim lifecycle action is ever blocked by this namespace.
