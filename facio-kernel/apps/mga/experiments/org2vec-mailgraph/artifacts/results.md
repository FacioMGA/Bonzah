# org2vec MailGraph — three-mode evaluation

LLM provider: `offline`

Question:

> Review this submitted claim file. What information gaps remain, what parts of the claim may be rejected or reserved, and what should the handler do next?

## Aggregate scores

| Metric | ChatGPT only | Manual RAG | MailGraph RAG |
|---|---|---|---|
| Missing-doc recall | 0% | 0% | 0% |
| Missing-doc precision | 0% | 0% | 0% |
| Escalation recall | 0% | 0% | 0% |
| Timeline accuracy | 0% | 0% | 0% |
| Evidence citation rate | 0% | 0% | 0% |
| Similar-claim relevance | 0% | 0% | 0% |
| JSON validity | 0% | 0% | 0% |

All scores are means over the synthesized corpus (15 CY-MTR-* + 4 ABB/VL/*). Higher is better.

## How to reproduce

```
cd experiments/org2vec-mailgraph
python -m org2vec.eval.runner
```
