# Facio org2vec MailGraph

> The real claim lives in email, not in the claims system.

A minimalistic, isolated Python prototype that turns claims email threads into
a structured operational knowledge base — events, timeline, missing-info,
authority flags, similar-claim retrieval — and surfaces it inside an embedded
**Claim Workspace co-pilot** (not a chatbot). Three-mode evaluation included.

This folder is intentionally isolated from the Abbeygate TypeScript platform.
It has its own dependencies, its own Python runtime, and no import path to or
from `backend/` or `frontend/`.

---

## 60-second tour

```bash
cd experiments/org2vec-mailgraph
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env       # fill in AZURE_OPENAI_* OR OPENAI_API_KEY
python3 scripts/synthesize_corpus.py   # writes corpus/threads/ + corpus/gold/
python3 scripts/build_kb.py             # writes corpus/kb/

streamlit run app.py        # demo
python3 -m org2vec.eval.runner     # three-mode evaluation -> artifacts/results.{csv,md,png}
pytest tests/               # deterministic tests, ~1s
```

### Model defaults

`.env.example` ships with `gpt-4o` + `text-embedding-3-large` to match the
assignment paper. For cheaper iteration set:

```
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_EMBED_MODEL=text-embedding-3-small
```

The LLM disk cache keys on `(provider, model, prompt)` so switching models
invalidates the old cache cleanly — first run after the change repopulates.

**Offline mode.** If no LLM credentials are present (or `ORG2VEC_OFFLINE=1`),
the pipeline still runs end-to-end via a deterministic hash-based embedding
fallback. Extraction and RAG calls degrade gracefully — the entities,
similar-claim graph, and Streamlit UI all work; the LLM-derived timeline,
missing-info and authority-flag cards stay empty until you connect a key.

---

## Demo flow (7 minutes)

1. **Login** — `Connect Microsoft 365` / `Connect Google` / `Use sample inbox`
   / `Upload .eml or .txt files` (drag-and-drop, no OAuth needed).
2. **Ingest** — pick filters, click Ingest, watch the progress stream
   (sourced from `artifacts/ingest-log.jsonl`, real events from the pipeline).
3. **Claim list** — sorted by risk (open gaps + authority flags). The
   workspace header shows the detected language, jurisdiction, and Lloyd's
   cross-reference for each claim.
4. **Claim Workspace** — open `CY-MTR-017`:
   - **Left** raw email thread evidence (per-message expanders with attachments).
   - **Center** extracted timeline + entities.
   - **Right** six co-pilot cards: Missing Information · Authority Flags ·
     Liability / Rejection · Recommended Next Action · Similar Historical
     Claims · Draft Email (downloadable `.eml`).
5. **Compare modes** (rubric panel) — ChatGPT-only vs Manual-RAG vs
   MailGraph-RAG, side by side, live.

The "wow" moment is the Similar Historical Claims card: the QuickFix Auto
estimate recurrence makes the graph hop pop `CY-MTR-011`, `CY-MTR-031`, and
the broker-recurrence pops `CY-MTR-015`. Every claim cites its evidence by
`thread_id/message_id` or `doc_id/chunk_id`.

---

## Architecture

```
Connect (MS / Google / Sample)
        ↓
Parser  →  Two-pass Extractor  →  Entities + Events
        ↓
        ↘  Embed (FAISS)         Manual KB chunks  →  Embed (FAISS)
        ↓
ClaimMemoryObject aggregator
        ↓
NetworkX graph  ←──── similar-claim retrieval (RRF fusion)
        ↓
Hybrid retriever (dense + BM25 + graph) → Evidence pack
        ↓
RAG composer → strict-JSON ThreadAnalysis → Citation verifier
        ↓
Streamlit Claim Workspace      Eval harness (3 modes)
```

The product spine is `ClaimMemoryObject`. Everything else is a thin transformer
over it. No second representation, no UI-specific shape.

---

## Three placements (where this lives in product terms)

| Placement | Audience | Status |
|---|---|---|
| A — Inbox / shared mailbox triage co-pilot | Front-line / unassigned mail | v0.3 backlog |
| **B — Claim Workspace co-pilot** | **Claims handler (THE DEMO)** | **Built in v0.2** |
| C — Portfolio intelligence dashboard | Management | v0.3 backlog |

A and C are independently sellable wedges on top of the same `ClaimMemoryObject`.
This prototype builds B.

---

## Corpus

`corpus/threads/` contains 19 deterministic synthesized claim email threads
modelled on real Abbeygate operational artifacts. 15 use the CY-MTR-XXX
training format; the remaining 4 use the production `ABB/VL/XXXXX` format
to exercise Portuguese-language handling, Lloyd's cross-references
(`ABLV/PT…`), Portuguese vehicle reg parsing, the EUR 25,000 DCA authority
gate, and **Endorsement No. 141 (GESY) — the rule that lives only in
email**.

- `[artifacts/motor-insurance-info/Std emails for claims.docx](../../artifacts/motor-insurance-info/Std%20emails%20for%20claims.docx)`
- `[artifacts/motor-insurance-info/Abbeygate_Motor_Claims_Operations_Manual.docx](../../artifacts/motor-insurance-info/Abbeygate_Motor_Claims_Operations_Manual.docx)`
- `[artifacts/motor-insurance-info/T.P Claims_Workflow.pdf](../../artifacts/motor-insurance-info/T.P%20Claims_Workflow.pdf)`
- `[artifacts/motor-insurance-info/LMA9188 - Asta obo Volante and Abbeygate Cyprus DCA Agreement 26022026.pdf](../../artifacts/motor-insurance-info/LMA9188%20-%20Asta%20obo%20Volante%20and%20Abbeygate%20Cyprus%20DCA%20Agreement%2026022026.pdf)`

Gold labels live in `corpus/gold/`. Each thread is engineered to exercise one
or two evaluation dimensions (3 clean controls; the rest cover missing-doc
recall, authority breach, repairer recurrence, third-party chase loop,
complaint escalation, BI potential, fraud indicator, slow broker, settlement
authority breach).

Threads are labelled honestly in the appendix as *"simulated, modelled on real
Abbeygate templates and operational manuals"*. Real anonymized threads from
Peter — or live threads pulled via the Microsoft / Google connectors —
drop into the same pipeline without code changes.

To rebuild deterministically:

```bash
python3 scripts/synthesize_corpus.py
python3 scripts/build_kb.py
```

---

## Evaluation

Three modes, same question, same 15 threads:

| Mode | Inputs |
|---|---|
| **A — ChatGPT only** | Question only |
| **B — Manual RAG** | Question + retrieved rule chunks |
| **C — MailGraph RAG** | Question + ClaimMemoryObject (messages + rules + graph hops), all citation-bound |

Metrics scored:

- Missing-doc **recall** + **precision** (fuzzy-matched with a synonym table)
- **Escalation recall** (authority/complaint/BI/fraud/TP-recovery flags)
- **Timeline accuracy** (event-type recall)
- **Evidence citation rate** (claims that resolve to a real evidence-pack item)
- **Similar-claim relevance** (intersection with gold similar threads)
- **JSON validity** (Pydantic-validated)

Run:

```bash
python3 -m org2vec.eval.runner
```

Outputs land in `artifacts/results.csv`, `artifacts/results.md`, and
`artifacts/results.png`. The runner is deterministic: temperature 0, fixed
seed, recorded LLM responses cached under `artifacts/llm-cache/`.

See [`artifacts/results.md`](artifacts/results.md) for the current run.

---

## Five appendix screenshots

Capture instructions: [`artifacts/screenshots/README.md`](artifacts/screenshots/README.md).

| File | Content |
|---|---|
| `01-ingestion.png` | One-click OAuth + progress stream |
| `02-workspace.png` | Full three-column Claim Workspace for `CY-MTR-017` |
| `03-copilot-detail.png` | The six co-pilot cards (close-up) |
| `04-similar-claims.png` | Card 5 expanded — `CY-MTR-011`, `CY-MTR-031`, `CY-MTR-015` |
| `05-compare-modes.png` | Three-mode comparison panel |

---

## Folder map

```
experiments/org2vec-mailgraph/
  app.py                              # Streamlit entrypoint
  pyproject.toml                      # pinned deps, ruff + pytest
  .env.example                        # AZURE_OPENAI_*, MS_CLIENT_ID, GOOGLE_*
  scripts/
    synthesize_corpus.py              # 15 threads + 15 gold files
    build_kb.py                       # KB chunks under corpus/kb/
  src/org2vec/
    models.py                         # the ONE contract spine
    connect/                          # Microsoft / Google / sample
    ingest/                           # parse + pipeline
    extract/                          # entities + events (two-pass)
    embed/                            # FAISS store
    graph/                            # NetworkX claim graph + queries
    retrieve/                         # dense + BM25 + RRF
    rag/                              # prompts + compose + verify
    memory/                           # ClaimMemoryObject builder + draft reply
    llm/                              # one provider abstraction + cache
    eval/                             # runner + score + report
  corpus/
    threads/                          # 15 .txt threads
    kb/                               # 48 .md chunks
    gold/                             # 15 .json gold labels
  tests/                              # 11 deterministic tests, ~1s
  artifacts/
    results.{csv,md,png}              # eval outputs
    screenshots/                      # 5 appendix screenshots
    llm-cache/                        # response cache (regenerated)
    index/                            # FAISS index (regenerated)
    ingest-log.jsonl                  # every progress event the UI showed
```

---

## v0.3 backlog (documented; out of scope for this prototype)

1. **Placement A — inbox triage co-pilot.** Per incoming thread, identify
   claim ref, classify, detect urgent issues, flag missing info, suggest
   routing. Reuses ingest + extract + memory unchanged.
2. **Placement C — portfolio intelligence dashboard.** SQL view over all
   `ClaimMemoryObject`s: claims missing docs, claims over authority, claims
   with no action in X days, repeat repairers, complaint risks, reserve
   leakage, slow brokers, delayed TP responses.
3. **Microsoft 365 admin consent + shared-inbox webhook.** Subscriptions API
   for live monitoring rather than polling.
4. **Attachment OCR.** Pdf / image attachments → text into the same evidence
   pack (Tesseract or Azure Document Intelligence).
5. **Neo4j swap-in.** Behind the existing `graph/` interface.
6. **Adapter from `ClaimMemoryObject` into the Abbeygate platform.** A thin
   read-only adapter — the prototype's contract becomes the platform's API.

---

## Naming discipline

This is not a chatbot. Call it:

- claims intelligence layer
- email-native institutional memory
- claim workspace co-pilot
- evidence-grounded decision support
- operational memory engine

Separate chatbots are where AI demos go to die. The co-pilot lives in the
right panel of the Claim Workspace, sourced from `ClaimMemoryObject`, exactly
where the handler needs judgment.
