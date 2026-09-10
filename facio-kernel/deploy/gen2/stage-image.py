#!/usr/bin/env python3
"""Load an integrity-checked release and start it on the private staging port."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--blob', required=True)
parser.add_argument('--sha256', required=True)
parser.add_argument('--image', required=True)
parser.add_argument('--artifact-base-image')
args = parser.parse_args()
if not re.fullmatch(r'gen2/[a-zA-Z0-9._-]+\.tar\.gz', args.blob): raise SystemExit('Invalid release path')
if not re.fullmatch(r'[a-f0-9]{64}', args.sha256): raise SystemExit('Invalid release digest')
if not re.fullmatch(r'facio-platform:[a-zA-Z0-9._-]+', args.image): raise SystemExit('Invalid image')
root = Path('/srv/facio-platform')
release = root / 'releases' / args.sha256
release.mkdir(parents=True, exist_ok=True)
archive = release / 'image.tar.gz'
if not archive.exists():
    request = urllib.request.Request('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F', headers={'Metadata': 'true'})
    with urllib.request.urlopen(request, timeout=10) as response: token = json.load(response)['access_token']
    request = urllib.request.Request(f'https://stkernelsandbox294904.blob.core.windows.net/releases/{args.blob}', headers={'Authorization': f'Bearer {token}', 'x-ms-version': '2023-11-03'})
    temporary = archive.with_suffix('.partial')
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024): output.write(chunk)
    temporary.rename(archive)
with archive.open('rb') as source:
    if hashlib.file_digest(source, 'sha256').hexdigest() != args.sha256: raise SystemExit('Release digest mismatch')
if args.artifact_base_image:
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', args.artifact_base_image): raise SystemExit('Invalid immutable runtime base')
    installed = subprocess.check_output(['docker', 'image', 'inspect', args.artifact_base_image, '--format', '{{.Id}} {{.Architecture}}'], text=True).strip()
    if installed != args.artifact_base_image + ' amd64': raise SystemExit('Expected Linux amd64 runtime base is not installed')
    stage = release / 'build'
    stage.mkdir(exist_ok=True)
    with tarfile.open(archive, 'r:gz') as package:
        package.extractall(stage, filter='data')
    manifest = json.loads((stage/'manifest.json').read_text())
    if manifest['baseImage'] != args.artifact_base_image or not re.fullmatch(r'[a-f0-9]{40}', manifest['sourceCommit']): raise SystemExit('Artifact manifest identity differs')
    if args.image != 'facio-platform:' + manifest['sourceCommit']: raise SystemExit('Image tag must identify the source commit')
    for name, digest in manifest['files'].items():
        candidate = (stage/name).resolve()
        if not candidate.is_relative_to((stage/'app').resolve()) or not candidate.is_file(): raise SystemExit('Invalid artifact path')
        with candidate.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != digest: raise SystemExit('Artifact digest mismatch')
    subprocess.run(['docker', 'build', '--network', 'none', '--pull=false', '-t', args.image, str(stage)], check=True)
else:
    subprocess.run(['docker', 'load', '-i', str(archive)], check=True)
# PostgreSQL schema ownership remains separate from the application role.
common = ['docker', 'run', '--rm', '--network', 'facio-platform_default', '--env-file', str(root / 'secrets/migrate.env'), args.image]
subprocess.run(common + ['npm', 'run', 'prisma:migrate:deploy'], check=True)
with (root / 'secrets/roles.sql').open('rb') as sql:
    subprocess.run(['docker', 'exec', '-i', 'facio-platform-postgres', 'psql', '-U', 'kernel_owner', '-d', 'facio_gen2', '-v', 'ON_ERROR_STOP=1'], stdin=sql, stdout=subprocess.DEVNULL, check=True)
subprocess.run(common + ['node', 'backend/dist/modules/platformTenants/infra/initializeCli.js', '--initialize-new-platform'], check=True)
release_env = root / 'deploy/release.env'
release_env.write_text(f'FACIO_PLATFORM_IMAGE={args.image}\n')
subprocess.run(['docker', 'compose', '--env-file', str(release_env), '-f', str(root / 'deploy/compose.yaml'), 'up', '-d', 'app'], check=True)
print(json.dumps({'stagedImage': args.image, 'archiveSha256': args.sha256, 'privatePort': 4320, 'publicCutover': False}))
