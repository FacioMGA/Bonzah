"""Build the rule-doc knowledge base under ``corpus/kb/*.md``.

The KB has two sources:

1. **Curated canonical chunks** (always present). Hand-extracted excerpts from the
   Abbeygate Motor Claims Operations Manual, the Cyprus DCA agreement
   (LMA9188), the Std emails for claims, and the TP Claims Workflow. These are
   the chunks the Manual-RAG baseline retrieves.

2. **Best-effort docx/pdf extraction** (optional). If ``python-docx`` and
   ``pypdf`` are installed and the source files under ``artifacts/motor-insurance-info/``
   are reachable, we additionally chunk them. Failures here are non-fatal —
   the canonical chunks are sufficient for the eval baseline.

Each chunk lands at ``corpus/kb/<doc_id>__<chunk_id>.md`` with a YAML header.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KB_DIR = ROOT / "corpus" / "kb"
REPO_ROOT = ROOT.parents[1]
ARTIFACTS_MOTOR = REPO_ROOT / "artifacts" / "motor-insurance-info"


@dataclass
class Chunk:
    doc_id: str
    chunk_id: str
    title: str
    source: str
    text: str


# ---------------------------------------------------------------------------
# Curated canonical chunks — always present.
# ---------------------------------------------------------------------------


CANONICAL: list[Chunk] = [
    Chunk(
        doc_id="abbeygate-motor-claims-ops-manual",
        chunk_id="01-fnol-required-information",
        title="FNOL — required information",
        source="Abbeygate Motor Claims Operations Manual (Cyprus)",
        text=(
            "On First Notification of Loss the handler must record: completed motor "
            "claim form, policy number, vehicle registration, registration document "
            "(V5 / Cyprus log book), incident date, time and location, photographs "
            "of damage and scene where available, third-party details where a third "
            "party is involved, third-party insurer and reference, witness "
            "statements or confirmation that no witness exists, and a police "
            "attendance number / police report where police attended."
        ),
    ),
    Chunk(
        doc_id="abbeygate-motor-claims-ops-manual",
        chunk_id="02-document-checklist",
        title="Standard document checklist",
        source="Abbeygate Motor Claims Operations Manual (Cyprus)",
        text=(
            "Standard outstanding-document checklist applied to every open claim: "
            "motor claim form (completed), photographs of damage, photographs of "
            "scene, repair estimate(s), vehicle registration document, third-party "
            "insurer letter or details, police attendance number / police report, "
            "witness statement(s) or confirmation that none exist, medical report "
            "if bodily injury is alleged. The checklist drives the standard "
            "documents-request email."
        ),
    ),
    Chunk(
        doc_id="abbeygate-motor-claims-ops-manual",
        chunk_id="03-liability-position",
        title="Liability position — reserve when evidence is incomplete",
        source="Abbeygate Motor Claims Operations Manual (Cyprus)",
        text=(
            "Liability must be reserved where independent evidence is incomplete: "
            "no witness statement, no CCTV, no police attendance. Where the third "
            "party disputes the version of events and no independent evidence "
            "exists, liability is reserved pending the third-party insurer's "
            "position. Reservation does not block authorising repair on a "
            "without-prejudice basis where the vehicle is undriveable or the "
            "insured's policy provides own-damage cover."
        ),
    ),
    Chunk(
        doc_id="abbeygate-motor-claims-ops-manual",
        chunk_id="04-bodily-injury",
        title="Bodily injury — flagging and reserving",
        source="Abbeygate Motor Claims Operations Manual (Cyprus)",
        text=(
            "If the insured or any third party reports pain, attends medical "
            "treatment, or signals an intention to pursue a bodily injury claim, "
            "the handler must flag BI potential and adjust reserves to reflect "
            "indemnity exposure. A medical report must be requested. BI claims "
            "are not within the standard own-damage authority and may require "
            "escalation regardless of monetary threshold."
        ),
    ),
    Chunk(
        doc_id="abbeygate-motor-claims-ops-manual",
        chunk_id="05-fraud-indicators",
        title="Fraud indicators — refer to fraud team",
        source="Abbeygate Motor Claims Operations Manual (Cyprus)",
        text=(
            "Common fraud indicators that must be referred to the fraud team: "
            "incident date predating policy inception, late notification without "
            "credible explanation, repeated claims by the same insured in short "
            "succession, repeated involvement of the same third party, photographs "
            "with metadata that contradicts the stated incident date, and "
            "estimates significantly higher than the visible damage."
        ),
    ),
    Chunk(
        doc_id="abbeygate-cyprus-dca-lma9188",
        chunk_id="01-delegated-authority-limit",
        title="Delegated authority — EUR 25,000 per claim",
        source="LMA9188 — Asta obo Volante and Abbeygate Cyprus DCA Agreement",
        text=(
            "The coverholder's delegated claims authority is EUR 25,000 per claim "
            "inclusive of indemnity and expenses. Any estimated incurred or any "
            "proposed settlement that exceeds EUR 25,000 must be referred to the "
            "managing agent before payment or settlement is agreed. Authority is "
            "not transferable and may not be sub-delegated."
        ),
    ),
    Chunk(
        doc_id="abbeygate-cyprus-dca-lma9188",
        chunk_id="02-referral-triggers",
        title="Referral triggers (mandatory)",
        source="LMA9188 — Asta obo Volante and Abbeygate Cyprus DCA Agreement",
        text=(
            "Mandatory referral triggers: estimate or settlement exceeding the "
            "delegated authority of EUR 25,000; any bodily injury indication; "
            "any complaint referred to a regulator; any fraud indicator; any "
            "coverage dispute; any incident with potential to attract media "
            "attention or class actions. Referral is documented in the claim "
            "file before the next handler action."
        ),
    ),
    Chunk(
        doc_id="abbeygate-tp-claims-workflow",
        chunk_id="01-tp-recovery-process",
        title="Third-party recovery process",
        source="TP Claims Workflow",
        text=(
            "Where the third party's insurer is identified and liability is "
            "accepted against them, a recovery request is issued within 5 working "
            "days of payment of the insured's own-damage indemnity. Chasers are "
            "sent at 14 and 28 days. Non-response after the second chaser is "
            "referred to the Cyprus Insurance Association reciprocal recovery "
            "process."
        ),
    ),
    Chunk(
        doc_id="abbeygate-tp-claims-workflow",
        chunk_id="02-missing-tp-details",
        title="Missing third-party details — no recovery possible",
        source="TP Claims Workflow",
        text=(
            "Where the third party cannot be identified (partial registration, "
            "hit-and-run, departed scene), no recovery is possible. The handler "
            "must request from the broker / insured: police attendance number, "
            "any CCTV footage from nearby premises, witness statements, and any "
            "dashcam recordings. The claim is paid as own-damage where cover "
            "applies, with no offset for unrecovered TP costs."
        ),
    ),
    Chunk(
        doc_id="abbeygate-std-emails-for-claims",
        chunk_id="01-documents-request-template",
        title="Documents-request template",
        source="Std emails for claims",
        text=(
            "Standard documents-request email template:\n\n"
            "Subject: [CLAIM_REF] — documents required\n\n"
            "Dear [BROKER_NAME],\n\n"
            "Thank you for your notification. To progress claim [CLAIM_REF] we "
            "require the following items:\n\n"
            "  [LIST_OF_MISSING_DOCUMENTS]\n\n"
            "Pending receipt of the above we are reserving our position on "
            "liability. Where independent evidence is unavailable we will "
            "consider authorising repair on a without-prejudice basis once "
            "estimates have been validated.\n\n"
            "Kind regards,\n[HANDLER]"
        ),
    ),
    Chunk(
        doc_id="abbeygate-std-emails-for-claims",
        chunk_id="02-authority-referral-template",
        title="Authority-referral template (managing agent)",
        source="Std emails for claims",
        text=(
            "Standard authority-referral template:\n\n"
            "Subject: [CLAIM_REF] — referral over delegated authority\n\n"
            "Estimate / proposed settlement on [CLAIM_REF] is EUR [AMOUNT], which "
            "exceeds delegated authority of EUR 25,000 under the Cyprus DCA. "
            "Liability position: [POSITION]. Evidence available: [EVIDENCE]. "
            "Recommended next step: [RECOMMENDATION]. Awaiting authority before "
            "any further commitment."
        ),
    ),
    Chunk(
        doc_id="abbeygate-complaints-handling",
        chunk_id="01-complaint-acknowledgement",
        title="Complaint acknowledgement timing",
        source="Complaints handling (FCA / Cyprus Insurance Commissioner)",
        text=(
            "Complaints must be acknowledged within one business day of receipt. "
            "A final response is required within eight weeks. Where a final "
            "response cannot be issued within eight weeks, the complainant is "
            "advised of the reason for the delay and informed of their right to "
            "refer the complaint to the Cyprus Insurance Commissioner."
        ),
    ),
    # ----------------------------------------------------------------- GESY
    # Endorsement No. 141 — GHS / GESY Claims Condition. The rule lives
    # *only* in a management email (Peter Sheppard, 2026-05-27). It is the
    # paper's headline example of operational knowledge that no manual or
    # policy schedule contains. The chunk MUST preserve clause (d) verbatim
    # so the RAG composer can quote it directly in any citation.
    Chunk(
        doc_id="abbeygate-endorsement-141-gesy",
        chunk_id="01-trigger",
        title="Endorsement No. 141 — GESY trigger condition (clause a)",
        source=(
            "Endorsement No. 141 — GHS/GESY Claims Condition "
            "(email, Managing Director, 2026-05-27)"
        ),
        text=(
            "Endorsement No. 141 — GHS/GESY Claims Condition (Cyprus operative). "
            "Trigger: where the Insured was confirmed at data capture to be "
            "registered with the General Health System (GESY / GHS), this "
            "endorsement applies to any claim notified under Section A of the "
            "policy (medical expenses). The endorsement does NOT apply where "
            "the Insured was confirmed at data capture as non-GESY."
        ),
    ),
    Chunk(
        doc_id="abbeygate-endorsement-141-gesy",
        chunk_id="02-required-evidence-clause-d",
        title="Endorsement No. 141 clause (d) — required documentary evidence",
        source=(
            "Endorsement No. 141 — GHS/GESY Claims Condition "
            "(email, Managing Director, 2026-05-27)"
        ),
        text=(
            "Clause (d). Before the Company admits or pays any claim under "
            "Section A for a GESY-registered Insured, the Insured must provide "
            "documentary evidence that GESY was approached regarding the "
            "illness or condition and that GESY declined, refused, or was "
            "unable to treat. In the absence of that evidence the Company has "
            "NO liability to pay. The handler MUST list these two items in any "
            "evidence request when GESY is confirmed at data capture: "
            "(i) documentary evidence GESY was approached, "
            "(ii) GESY written confirmation of decline, refusal, or inability "
            "to treat. Suggested template: 'Request for GESY Documentary "
            "Evidence'."
        ),
    ),
    # ----------------------------------------------------------------- ABG liability procedure
    Chunk(
        doc_id="abg-liability-procedure",
        chunk_id="01-position-of-liability",
        title="ABG Claims — Our Position of Liability and Proposed Process",
        source=(
            "ABG Claim Handling — Our Position of Liability and Proposed Process "
            "(email, peter@abbeygate.cy, 2026-04-08)"
        ),
        text=(
            "Liability is NOT accepted by Abbeygate without supporting evidence. "
            "The burden of proof remains with the claimant at all times. All "
            "external correspondence must confirm that liability is reserved "
            "pending independent evidence; the handler does not admit or deny "
            "fault. Files are maintained centrally in English for Lloyd's "
            "audit. ASF / Cyprus ICCS compliance is mandatory across PT and CY."
        ),
    ),
    # ----------------------------------------------------------------- FNOL Motor V2
    Chunk(
        doc_id="fnol-motor-v2",
        chunk_id="01-non-approved-repairer",
        title="FNOL Motor V2 — non-approved repairer / assessor process",
        source="FNOL Motor V2 client letter template",
        text=(
            "Where the insured presents a repair estimate from a garage that "
            "is not an Abbeygate approved or nominated repairer, the handler "
            "must instruct an approved assessor to inspect the vehicle at the "
            "insured's choice of garage. The assessor reports to the insurer. "
            "Excess applies to settlement; insured pays the excess directly to "
            "the repairer and signs a discharge receipt on completion."
        ),
    ),
    # ----------------------------------------------------------------- Endorsement codes
    Chunk(
        doc_id="abbeygate-binder-endorsements",
        chunk_id="01-cv4-cv5-excess",
        title="CV4 / CV5 — accidental damage excess endorsements",
        source="Abbeygate Cyprus Binder — operative endorsement codes",
        text=(
            "Endorsement CV4 (Accidental Damage Excess) applies a fixed excess "
            "of EUR 300 to settlement under Section 2 (own damage). CV5 raises "
            "the excess to EUR 500. The excess is paid by the insured directly "
            "to the repairer; a signed discharge receipt is required on "
            "completion. Neither endorsement carries a premium."
        ),
    ),
    Chunk(
        doc_id="abbeygate-binder-endorsements",
        chunk_id="02-cv172-ncd-protection",
        title="CV172 — No-Claim Discount protection",
        source="Abbeygate Cyprus Binder — operative endorsement codes",
        text=(
            "Endorsement CV172 (No Claim Protection) is active when the "
            "insured has accrued 5+ years of unbroken NCD. With CV172 active, "
            "one fault claim in any policy year does NOT reduce the NCD. A "
            "second fault claim within the same policy year removes protection "
            "and the NCD steps down per the standard scale. Premium impact: "
            "+EUR 45 flat fee per policy year."
        ),
    ),
    Chunk(
        doc_id="abbeygate-binder-endorsements",
        chunk_id="03-cv999-vehicle-location",
        title="CV999 — vehicle location condition",
        source="Abbeygate Cyprus Binder — operative endorsement codes",
        text=(
            "Endorsement CV999 requires the vehicle to be ordinarily kept at "
            "the address shown in the Statement of Fact. The handler confirms "
            "this against the FNOL incident location. Cross-border incidents "
            "(e.g. Cyprus-registered vehicle in Spain) are covered subject to "
            "the territorial limits in the Green Card; CV999 does not block "
            "cross-border claims provided the vehicle's ordinary location is "
            "as declared."
        ),
    ),
]


# ---------------------------------------------------------------------------
# Best-effort docx / pdf extraction.
# ---------------------------------------------------------------------------


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower())
    return s.strip("-")[:64]


def _docx_text(path: Path) -> list[str]:
    try:
        from docx import Document
    except ImportError:
        return []
    try:
        doc = Document(str(path))
        return [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    except Exception as exc:  # noqa: BLE001
        print(f"  warn: docx parse failed for {path.name}: {exc}", file=sys.stderr)
        return []


def _pdf_text(path: Path) -> list[str]:
    try:
        from pypdf import PdfReader
    except ImportError:
        return []
    try:
        reader = PdfReader(str(path))
        out: list[str] = []
        for page in reader.pages:
            t = page.extract_text() or ""
            for line in t.split("\n"):
                line = line.strip()
                if line:
                    out.append(line)
        return out
    except Exception as exc:  # noqa: BLE001
        print(f"  warn: pdf parse failed for {path.name}: {exc}", file=sys.stderr)
        return []


def _chunks_from_paragraphs(
    paragraphs: list[str], doc_id: str, source: str, target_chars: int = 900
) -> list[Chunk]:
    out: list[Chunk] = []
    buf: list[str] = []
    size = 0
    idx = 0
    for p in paragraphs:
        if size + len(p) > target_chars and buf:
            text = "\n".join(buf).strip()
            if text:
                out.append(
                    Chunk(
                        doc_id=doc_id,
                        chunk_id=f"auto-{idx:03d}",
                        title=text.split(".")[0][:80],
                        source=source,
                        text=text,
                    )
                )
                idx += 1
            buf = [p]
            size = len(p)
        else:
            buf.append(p)
            size += len(p)
    if buf:
        text = "\n".join(buf).strip()
        if text:
            out.append(
                Chunk(
                    doc_id=doc_id,
                    chunk_id=f"auto-{idx:03d}",
                    title=text.split(".")[0][:80],
                    source=source,
                    text=text,
                )
            )
    return out


def _best_effort_sources() -> list[Chunk]:
    out: list[Chunk] = []
    if not ARTIFACTS_MOTOR.exists():
        return out
    for path in sorted(ARTIFACTS_MOTOR.iterdir()):
        if path.suffix.lower() == ".docx":
            paras = _docx_text(path)
            doc_id = "docx-" + _slug(path.stem)
            out.extend(_chunks_from_paragraphs(paras, doc_id, path.name))
        elif path.suffix.lower() == ".pdf":
            paras = _pdf_text(path)
            doc_id = "pdf-" + _slug(path.stem)
            out.extend(_chunks_from_paragraphs(paras, doc_id, path.name))
    return out


# ---------------------------------------------------------------------------
# Writer.
# ---------------------------------------------------------------------------


def _write(chunk: Chunk) -> None:
    path = KB_DIR / f"{chunk.doc_id}__{chunk.chunk_id}.md"
    header = (
        "---\n"
        f"doc_id: {chunk.doc_id}\n"
        f"chunk_id: {chunk.chunk_id}\n"
        f"title: {chunk.title}\n"
        f"source: {chunk.source}\n"
        "---\n\n"
    )
    path.write_text(header + chunk.text + "\n")


def main() -> None:
    KB_DIR.mkdir(parents=True, exist_ok=True)
    for old in KB_DIR.glob("*.md"):
        old.unlink()

    chunks = list(CANONICAL)
    chunks.extend(_best_effort_sources())

    for c in chunks:
        _write(c)
    print(f"Wrote {len(chunks)} KB chunks to {KB_DIR}")
    print(f"  canonical: {len(CANONICAL)}")
    print(f"  best-effort (docx/pdf): {len(chunks) - len(CANONICAL)}")


if __name__ == "__main__":
    main()
