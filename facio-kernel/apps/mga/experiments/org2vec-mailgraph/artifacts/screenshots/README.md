# Five appendix screenshots — capture guide

Each screenshot below is engineered to fall out of one specific Streamlit
state. Configure `AZURE_OPENAI_API_KEY` (or `OPENAI_API_KEY`) in `.env`
first — the eval and the timeline/missing-info/authority cards need a real
LLM to populate meaningfully.

```
streamlit run app.py
```

| File | Where to capture | What to show |
|---|---|---|
| `01-ingestion.png` | Screen 1 + Screen 2 (stitched) | The login card with the three buttons + the progress stream during ingest |
| `02-workspace.png` | Screen 4 (full window) for `CY-MTR-017` | The three-column layout: evidence (left), timeline (center), co-pilot cards (right) |
| `03-copilot-detail.png` | Right column close-up for `CY-MTR-017` | All six co-pilot cards with citations visible |
| `04-similar-claims.png` | Card 5 expanded for `CY-MTR-017` | `CY-MTR-011`, `CY-MTR-031`, `CY-MTR-015` with their shared-entity rationales |
| `05-compare-modes.png` | Screen 4 with "Compare modes" panel open | Three side-by-side JSON outputs |

After capturing, save each as a `.png` here (`artifacts/screenshots/`) using the
filenames above. They will be picked up by the assignment appendix.

## One-liner state setup

```bash
ORG2VEC_SEED=20260528 streamlit run app.py
```

Then in the UI:

1. Click **Use sample inbox**.
2. Click **Ingest** with default filters → screenshot `01`.
3. Click **Open CY-MTR-017** → screenshot `02`.
4. Crop the right column → screenshot `03`.
5. Expand card 5 → screenshot `04`.
6. Click **Compare modes ▾** → **Run all three** → screenshot `05`.
