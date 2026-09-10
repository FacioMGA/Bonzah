#!/usr/bin/env python3
"""Package a verified JS/web build against an identical locked Linux runtime base.

The canonical full image remains Dockerfile.platform. This small release archive
reuses its exact content-addressed dependency/Chromium layer on the sandbox VM.
No dependencies, generated Prisma client, credentials or native binaries are
copied from the developer machine.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--commit', required=True)
parser.add_argument('--base-image', required=True)
parser.add_argument('--base-lock', type=Path, required=True)
parser.add_argument('--base-schema', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if not re.fullmatch(r'[a-f0-9]{40}', args.commit): raise SystemExit('A full source commit is required')
if not re.fullmatch(r'sha256:[a-f0-9]{64}', args.base_image): raise SystemExit('An immutable base image is required')
root = Path(__file__).resolve().parents[2]
source = root / 'apps/mga'
if subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() != args.commit: raise SystemExit('Source HEAD differs')
if subprocess.check_output(['git', 'status', '--porcelain', '--', 'apps/mga'], cwd=root, text=True).strip(): raise SystemExit('Application source must be committed before packaging')
for expected, actual in [(args.base_lock, source/'package-lock.json'), (args.base_schema, source/'prisma/schema.prisma')]:
    if expected.read_bytes() != actual.read_bytes(): raise SystemExit('Dependencies or Prisma schema changed: build the full canonical Linux image')
with tempfile.TemporaryDirectory(prefix='facio-release-') as temporary:
    stage = Path(temporary)
    app = stage / 'app'
    def copy(relative, destination=None):
        src = source / relative
        dest = app / (destination or relative)
        if not src.exists(): raise SystemExit(f'Missing build artifact: {relative}')
        if src.is_dir(): shutil.copytree(src, dest, dirs_exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
    copy('backend/dist')
    copy('frontend/dist', 'dist')
    for package in ['validation', 'products']:
        copy(f'packages/{package}/dist')
        copy(f'packages/{package}/package.json')
    copy('prisma')
    copy('email-templates-temp')
    copy('frontend/src/modules/policies/list/registry.json')
    copy('backend/platform/behavior/manifest/policyBehaviorManifest.json', 'backend/dist/platform/behavior/manifest/policyBehaviorManifest.json')
    for product in ['home', 'travel', 'health', 'motor', 'commercial', 'rental']:
        for folder in ['documents/templates', 'documents/static', 'pricing/data']:
            relative = f'backend/products/{product}/{folder}'
            if (source/relative).is_dir():
                # Assets are explicit runtime directories; source calculators remain compiled JS.
                copy(relative, relative.replace('backend/', 'backend/dist/', 1))
    copy('backend/modules/communications/infra/adapters/static', 'backend/dist/modules/communications/infra/adapters/static')
    copy('package.json')
    for path in app.rglob('*'):
        if path.is_symlink() or path.name.startswith('.env') or path.name in ('node_modules', '.local'):
            raise SystemExit(f'Unexpected artifact: {path.relative_to(app)}')
    manifest = {'sourceCommit': args.commit, 'baseImage': args.base_image, 'dependencyLockSha256': hashlib.sha256(args.base_lock.read_bytes()).hexdigest(), 'files': {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(app.rglob('*')) if p.is_file()}}
    (stage/'manifest.json').write_text(json.dumps(manifest, sort_keys=True)+'\n')
    (stage/'Dockerfile').write_text(f'''FROM {args.base_image}
USER root
RUN rm -rf /app/backend/dist /app/dist /app/packages/validation/dist /app/packages/products/dist /app/prisma
COPY --chown=1001:1001 app/ /app/
ENV BUILD_SHA={args.commit}
LABEL org.opencontainers.image.revision={args.commit}
USER nodejs
''')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.output, 'w:gz') as archive:
        for path in sorted(stage.iterdir()): archive.add(path, arcname=path.name)
with args.output.open('rb') as source_file:
    digest = hashlib.file_digest(source_file, 'sha256').hexdigest()
print(json.dumps({'archive': str(args.output), 'sha256': digest, 'bytes': args.output.stat().st_size, 'commit': args.commit, 'baseImage': args.base_image}))
