import fs from 'node:fs';
import path from 'node:path';

// Non-PDF runtime assets that must exist in source before the image is built.
// Static PDFs are NOT listed here — they are auto-discovered below so a new
// product/territory asset can never be forgotten (see ADR-0047 incident).
const REQUIRED_RUNTIME_FILES = [
  'frontend/src/modules/policies/list/registry.json',
  'backend/products/motor/documents/templates/certificate.html',
  'backend/products/motor/documents/templates/schedule.html',
  'backend/products/motor/documents/templates/endorsements.html',
  'backend/products/motor/documents/templates/invoice.html',
  // Home omits a standalone Certificate template on purpose: the Schedule's
  // first page is the Lloyd's policy jacket, so a sibling Certificate would
  // duplicate the same cover under a different filename. See the matching
  // comment in `backend/products/home/documents/documentPackContract.ts`.
  'backend/products/home/documents/templates/schedule.html',
  'backend/products/home/documents/templates/statement-of-fact.html',
  'backend/products/travel/documents/templates/certificate.html',
  'backend/products/travel/documents/templates/schedule.html',
  'backend/products/travel/documents/templates/ipid.html',
  'backend/products/travel/documents/templates/medical-card.html',
  'backend/platform/behavior/manifest/policyBehaviorManifest.json',
];

// Docker images that must ship every runtime static-PDF dir. The ADR-0047
// incident was a static dir present in source but never COPYed into these
// images — `tsc` does not emit `.pdf`, so the asset was silently absent and
// the worker threw ENOENT on the send path. We assert COPY coverage here so
// the omission fails CI (in source) as well as at image build (`RUN test -f`).
const DOCKERFILES_REQUIRING_STATIC = [
  'infrastructure/docker/Dockerfile.api',
  'infrastructure/docker/Dockerfile.worker',
];

const STATIC_PDF_ROOT = 'backend';

function checkFile(relPath) {
  const abs = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(abs)) return { ok: false, relPath, abs, reason: 'missing' };
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return { ok: false, relPath, abs, reason: 'not_file' };
    if (stat.size <= 0) return { ok: false, relPath, abs, reason: 'empty' };
    return { ok: true, relPath, abs };
  } catch (e) {
    return { ok: false, relPath, abs, reason: String(e?.message || e || 'stat_failed') };
  }
}

// Recursively collect every `**/static/*.pdf` under `root`. macOS sync
// conflicts (`* 2.pdf`) are ignored — they are duplicates, not runtime assets.
function discoverStaticPdfs(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.pdf') &&
        path.basename(dir) === 'static' &&
        !/ \d+\.pdf$/i.test(entry.name)
      ) {
        found.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(path.resolve(process.cwd(), root));
  return found.sort();
}

function main() {
  const staticPdfs = discoverStaticPdfs(STATIC_PDF_ROOT);
  const allFiles = [...REQUIRED_RUNTIME_FILES, ...staticPdfs];
  const results = allFiles.map(checkFile);
  const failures = results.filter((r) => !r.ok);

  // Cross-check: every static dir that holds a runtime PDF must be COPYed into
  // each production Dockerfile. This is the guard that would have caught the
  // ADR-0047 ENOENT (dir in source, not in image).
  //
  // This same script also runs INSIDE the image build (`build:api` ->
  // `verify:runtime-artifacts`, from the Dockerfile's `backend-builder` stage),
  // where the build context deliberately omits `infrastructure/` — so the
  // Dockerfiles are simply not on disk there. That is NOT a gap: it means we are
  // in the reduced build context, not the full repo. Treat an absent Dockerfile
  // as "check not applicable here" and skip it; CI/local runs on a full checkout
  // and still enforce the cross-check. (A Dockerfile that exists but cannot be
  // read is a real error.) The PDF existence checks above run in both contexts.
  const staticDirs = [...new Set(staticPdfs.map((p) => path.dirname(p)))].sort();
  const copyGaps = [];
  let dockerfilesChecked = 0;
  for (const dockerfile of DOCKERFILES_REQUIRING_STATIC) {
    const abs = path.resolve(process.cwd(), dockerfile);
    if (!fs.existsSync(abs)) continue; // reduced build context — not applicable
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      copyGaps.push(`${dockerfile}: unreadable (${String(e?.message || e)})`);
      continue;
    }
    dockerfilesChecked += 1;
    for (const dir of staticDirs) {
      // Match a COPY line that references the dir (path uses forward slashes).
      const needle = dir.split(path.sep).join('/');
      if (!text.includes(needle)) {
        copyGaps.push(`${dockerfile}: no COPY for static dir '${needle}'`);
      }
    }
  }

  if (failures.length > 0 || copyGaps.length > 0) {
    for (const f of failures) {
      // eslint-disable-next-line no-console
      console.error(`[runtime-artifacts] missing/invalid: ${f.relPath} (${f.reason}) -> ${f.abs}`);
    }
    for (const gap of copyGaps) {
      // eslint-disable-next-line no-console
      console.error(`[runtime-artifacts] Dockerfile COPY gap: ${gap}`);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[runtime-artifacts] ok (${REQUIRED_RUNTIME_FILES.length} listed + ${staticPdfs.length} discovered static PDFs; ` +
      `${staticDirs.length} static dirs cross-checked against ${dockerfilesChecked}/${DOCKERFILES_REQUIRING_STATIC.length} Dockerfiles` +
      `${dockerfilesChecked < DOCKERFILES_REQUIRING_STATIC.length ? ' — others absent (reduced build context)' : ''})`,
  );
}

main();
